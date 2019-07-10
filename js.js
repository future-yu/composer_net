'use strict';

const NS = 'org.control.reserve.platform';

const BidderType = {
    AGGREGATOR: 'AGGREGATOR',
    POWER_PLANT: 'POWER_PLANT'
};
const TenderStatus = {
    CREATED: 'CREATED',
    IN_PROGRESS: 'IN_PROGRESS',
    FINISHED: 'FINISHED'
};
const TestResult = {
    PASS: 'PASS',
    FAIL: 'FAIL'
};
const EnergyPricePaymentDirection = {
    GRID_TO_TECHNICAL_UNIT: 'GRID_TO_TECHNICAL_UNIT',
    TECHNICAL_UNIT_TO_GRID: 'TECHNICAL_UNIT_TO_GRID'
};
const ProductType = {
    POSITIVE: 'POSITIVE',
    NEGATIVE: 'NEGATIVE'
};
const ProductTimeSlice = {
    from00To04: 'from00To04',
    from04To08: 'from04To08',
    from08To12: 'from08To12',
    from12To16: 'from12To16',
    from16To20: 'from16To20',
    from20To24: 'from20To24'
};

const ONE_DAY_SLICES_6 = ['from00To04', 'from04To08', 'from08To12', 'from12To16', 'from16To20', 'from20To24'];
const SLICES16 = ['from000To015', 'from015To030', 'from030To045', 'from045To060',
    'from060To075', 'from075To090', 'from090To105', 'from105To120',
    'from120To135', 'from135To150', 'from150To165', 'from165To180',
    'from180To195', 'from195To210', 'from210To225', 'from225To240'];

function getData(path) {
    return new Promise((resolve, reject) => {
        let xhr;
        if (window.XMLHttpRequest) {
            xhr = new XMLHttpRequest();
        } else {
            xhr = new ActiveXObject('Microsoft.XMLHTTP');
        }
        //发送请求
        xhr.open('get', 'http://localhost:8088' + path, false);
        xhr.send();
        //同步接受响应
        if (xhr.readyState == 4) {
            if (xhr.status == 200) {
                //实际操作
                resolve(JSON.parse(xhr.responseText))
            } else {
                reject(xhr.statusText)
            }
        } else {
            reject(xhr.statusText)
        }
    })

}


/**
 * add TechnicalUnit to Bidder
 * 给Bidder添加附属的TechnicalUnit
 *
 * @param {org.control.reserve.platform.AddTechnicalUnitToBidder} tx
 * @transaction
 */
async function addTechnicalUnitToBidder(tx) {
    let bidderParam = tx.bidder;

    // 新建招标
    if (!bidderParam.technicalUnits) {
        bidderParam.technicalUnits = [];
    }
    bidderParam.technicalUnits.push(tx.technicalUnit);

    let bidderRegistry = await getParticipantRegistry(`${NS}.Bidder`);
    await bidderRegistry.update(bidderParam);
}

/**
 * start a tender.
 * 开始招标，招标者输入各项信息（包括招标日期，截止日期，招标的电量类型，招标的具体时间段，
 * 以及招标电量）进行招标，更新资产注册列表
 *
 * @param {org.control.reserve.platform.AddDemand} tx
 * @transaction
 */
async function addDemand(tx) {
    let demandParam = tx.demand;

    // 新建招标
    let factory = getFactory();
    let demand = factory.newResource(NS, 'Demand', demandParam.demandId);
    demand.reserveType = 'aFRR';
    demand.tenderType = 'Daily';
    demand.deliveryPeriod = demandParam.deliveryPeriod;
    demand.tenderDeadline = demandParam.tenderDeadline;
    demand.negative = demandParam.negative;
    demand.positive = demandParam.positive;

    let demandRegistry = await getAssetRegistry(`${NS}.Demand`);
    await demandRegistry.add(demand);

    // 招标开始事件
    console.log("emit TenderStartedEvent");
    let tenderStartedEvent = factory.newEvent(NS, 'TenderStartedEvent');
    tenderStartedEvent.demand = factory.newRelationship(NS, 'Demand', demandParam.demandId);
    emit(tenderStartedEvent);
}


/**
 * Make an offer.
 * 检查拍卖是否关闭，如果没有关闭，允许竞标者进行报价（包括招标日期，招标的电量类型，招标的具体时间段，
 * 保留价格，调用价格，以及能够提供的电量）；更新相应的注册列表。
 *
 * @param {org.control.reserve.platform.MakeOffer} tx
 * @transaction
 */
async function makeOffer(tx) {
    let offerParam = tx.offer;
    let bidderParam = tx.bidder;
    let demandParam = tx.demand;

    if (demandParam.status == TenderStatus.FINISHED) {
        throw new Error("Tender is already over...!");
    }
    if (new Date().getTime() > demandParam.tenderDeadline.getTime()) {
        throw new Error("Tender is time over...!");
    }

    // 新建竞标
    let factory = getFactory();
    let offer = factory.newResource(NS, 'Offer', offerParam.offerId);

    offer.name = offerParam.name;
    offer.negative = offerParam.negative;
    offer.positive = offerParam.positive;

    offer.bidder = bidderParam;
    offer.demand = demandParam;

    console.log("update registry: offer");
    let offerRegistry = await getAssetRegistry(`${NS}.Offer`);
    await offerRegistry.add(offer);

    // 加入竞标者的竞标列表
    if (!bidderParam.offers) {
        bidderParam.offers = [];
    }
    bidderParam.offers.push(offer);

    console.log("update registry: bidder");
    let bidderRegistry = await getParticipantRegistry(`${NS}.Bidder`)
    await bidderRegistry.update(bidderParam);
}


/**
 * stop the Tender
 * 对竞标结果按照 capacityPrice 进行排序删选，列出中标结果，更新注册列表
 *
 * @param {org.control.reserve.platform.StopTender} tx - the Tender stop
 * @transaction
 */
async function stopTender(tx) {
    let demandParam = tx.demand;
    if (demandParam.status == TenderStatus.FINISHED) {
        throw new Error("Tender is already over...!");
    } else if (demandParam.status == TenderStatus.CREATED) {
        throw new Error("Tender is Not Start Yet...!");
    } else if (demandParam.status == TenderStatus.IN_PROGRESS) {
        demandParam.status = TenderStatus.FINISHED;
    }

    let factory = getFactory();
    let demandRel = factory.newRelationship(NS, 'Demand', demandParam.demandId);
    let offers = await query('showOfferByDemand', {demandParam: demandRel.toURI()});
    console.log(offers);

    // 更新入选的竞标信息
    let negative = factory.newConcept(NS, 'SortedOffer6');
    for (let prop of ONE_DAY_SLICES_6) {
        let arr = [];

        // 把所有竞标按照 capacityPrice 从低到高排序
        let sorted = offers.sort((o1, o2) => o1.negative.capacityPrice[prop] - o2.negative.capacityPrice[prop]);
        // console.log(JSON.stringify(sorted));

        // 对排列好的报价表进行筛选，直到竞标总量能够满足招标的电量需求
        let sum = 0;
        for (let offer of sorted) {
            if (sum >= demandParam.negative[prop]) {
                break;
            }

            let winnerInfo = factory.newConcept(NS, 'WinnerInfo');
            winnerInfo.offer = offer;

            // 当被选入的最后一名竞标者i的提供量 > 总需求量减去竞标者i-1的总和时，
            // 最后一名竞标者被分配到的电量为总需求量减去i-1个竞标量的总和
            if (offer.negative.offeredCapacity[prop] > demandParam.negative[prop] - sum) {
                winnerInfo.allocatedCapacity = demandParam.negative[prop] - sum;
            } else {
                winnerInfo.allocatedCapacity = offer.negative.offeredCapacity[prop];
            }

            arr.push(winnerInfo);
            sum += winnerInfo.allocatedCapacity;
        }

        negative[prop] = arr;
    }
    // console.log(negative);

    let positive = factory.newConcept(NS, 'SortedOffer6');
    for (let prop of ONE_DAY_SLICES_6) {
        let arr = [];

        // 把所有竞标按照 capacityPrice 从低到高排序
        let sorted = offers.sort((o1, o2) => o1.positive.capacityPrice[prop] - o2.positive.capacityPrice[prop]);
        // console.log(JSON.stringify(sorted));

        // 对排列好的报价表进行筛选，直到竞标总量能够满足招标的电量需求
        let sum = 0;
        for (let offer of sorted) {
            if (sum >= demandParam.positive[prop]) {
                break;
            }

            let winnerInfo = factory.newConcept(NS, 'WinnerInfo');
            winnerInfo.offer = offer;

            // 当被选入的最后一名竞标者i的提供量 > 总需求量减去竞标者i-1的总和时，
            // 最后一名竞标者被分配到的电量为总需求量减去i-1个竞标量的总和
            if (offer.positive.offeredCapacity[prop] > demandParam.positive[prop] - sum) {
                winnerInfo.allocatedCapacity = demandParam.positive[prop] - sum;
            } else {
                winnerInfo.allocatedCapacity = offer.positive.offeredCapacity[prop];
            }

            arr.push(winnerInfo);
            sum += winnerInfo.allocatedCapacity;
        }

        positive[prop] = arr;
    }
    // console.log(positive);

    let selectedList = factory.newResource(NS, 'SelectedList', demandParam.demandId);
    selectedList.negative = negative;
    selectedList.positive = positive;

    let selectedListRegistry = await getAssetRegistry(`${NS}.SelectedList`);
    await selectedListRegistry.add(selectedList);

    // 招标结束事件
    console.log("emit TenderStoppedEvent");
    let tenderStoppedEvent = factory.newEvent(NS, 'TenderStoppedEvent');
    tenderStoppedEvent.demand = factory.newRelationship(NS, 'Demand', demandParam.demandId);
    emit(tenderStoppedEvent);

    // 竞标结果事件
    console.log("emit AnnounceTenderResultsEvent");
    let announceTenderResultsEvent = factory.newEvent(NS, 'AnnounceTenderResultsEvent');
    announceTenderResultsEvent.demand = factory.newRelationship(NS, 'Demand', demandParam.demandId);
    emit(announceTenderResultsEvent);
}


/**
 * sort
 * 对上一个函数的删选结果按照再按照 energyPrice 重新进行排序，更新相应的注册列表
 *
 * @param {org.control.reserve.platform.PreparatoryDeploy} tx - sort
 * @transaction
 */
async function preparatoryDeploy(tx) {
    let demandParam = tx.demand;

    let selectedListRegistry = await getAssetRegistry(`${NS}.SelectedList`);
    let selectedList = await selectedListRegistry.get(demandParam.demandId);
    console.log(selectedList);
    // console.log(JSON.stringify(selectedList));

    // 获取所有的竞标
    let offerRegistry = await getAssetRegistry(`${NS}.Offer`);

    for (let prop of ONE_DAY_SLICES_6) {
        for (let info of selectedList.negative[prop]) {
            let id = info.offer.getIdentifier();
            info.offer = await offerRegistry.get(id);
        }
        ;
    }
    for (let prop of ONE_DAY_SLICES_6) {
        for (let info of selectedList.positive[prop]) {
            let id = info.offer.getIdentifier();
            info.offer = await offerRegistry.get(id);
        }
        ;
    }
    // console.log(JSON.stringify(selectedList));

    // 针对 ProductType 为positive的情况，把所有竞标按照 energyPrice 从低到高排序
    // 针对 ProductType 为negative的情况，把所有竞标按照 energyPrice 从高到低排序
    for (let prop of ONE_DAY_SLICES_6) {
        selectedList.negative[prop].sort((info1, info2) => info2.offer.negative.energyPrice[prop] - info1.offer.negative.energyPrice[prop]);
    }
    for (let prop of ONE_DAY_SLICES_6) {
        selectedList.positive[prop].sort((info1, info2) => info1.offer.positive.energyPrice[prop] - info2.offer.positive.energyPrice[prop]);
    }
    // console.log(JSON.stringify(selectedList));

    // 加入PreparatoryList
    let factory = getFactory();
    let preparatoryList = factory.newResource(NS, 'PreparatoryList', demandParam.demandId);
    preparatoryList.negative = selectedList.negative;
    preparatoryList.positive = selectedList.positive;

    let preparatoryListRegistry = await getAssetRegistry(`${NS}.PreparatoryList`);
    await preparatoryListRegistry.add(preparatoryList);
}


/**
 * Aggregator 上传分配给provider的电量的列表。
 *
 * @param {org.control.reserve.platform.DistributeProcuredSCR} tx
 * @transaction
 */

async function distributeProcuredSCR(tx) {
    let distributionParam = tx.distribution;
    let negativeParam = tx.distribution.negative;
    let positiveParam = tx.distribution.positive;

    let factory = getFactory();
    let distribution = factory.newResource(NS, 'Distribution', distributionParam.distributionId);

    if (distribution.offer.bidder.type != BidderType.AGGREGATOR) {
        throw new Error("Bidder is not an Aggregator");
    }

    let preparatoryListRegistry = await getAssetRegistry(`${NS}.PreparatoryList`);
    let preparatoryList = await preparatoryListRegistry.get(distribution.offer.demand.demandId);

    let negative = factory.newConcept(NS, 'DistributionInfo6');
    let positive = factory.newConcept(NS, 'DistributionInfo6');

    //计算Distribution
    for (let prop of ONE_DAY_SLICES_6) {
        // 去除不附属的provider
        positiveParam[prop] = positiveParam[prop].filter(slot => distribution.offer.bidder.technicalUnits.findIndex(p => slot.technicalUnit.technicalUnitId == p.technicalUnitId) != -1);
        negativeParam[prop] = negativeParam[prop].filter(slot => distribution.offer.bidder.technicalUnits.findIndex(p => slot.technicalUnit.technicalUnitId == p.technicalUnitId) != -1);

        // 把 provider 按照 capacityPrice 从低到高排序
        positiveParam[prop].sort((slot1, slot2) => slot1.technicalUnit.capacityPrice - slot2.technicalUnit.capacityPrice);
        negativeParam[prop].sort((slot1, slot2) => slot1.technicalUnit.capacityPrice - slot2.technicalUnit.capacityPrice);

        negative[prop] = [];
        positive[prop] = [];
        let winnerInfo = preparatoryList.negative[prop].find(info => info.offer.getIdentifier() == distribution.offer.offerId);
        let total = winnerInfo.allocatedCapacity / 100 * 110;
        let sumPS = 0;
        let sumNG = 0;

        //按照capacityPrice进行第一次排序
        for (let [i, ds] of negativeParam[prop].entries()) {  //遍历每一个technicalUnit
            if (sumNG >= total) {
                break;
            }

            let allocatedCapacity = ds.technicalUnit.offeredCapacity;  //竞拍的电量
            if (allocatedCapacity > total - sumNG) {
                allocatedCapacity = (total * 100 - sumNG * 100) / 100;
            }
            sumNG += allocatedCapacity;
            let slot = factory.newConcept(NS, 'DistributionSlot');
            slot.technicalUnit = ds.technicalUnit;
            slot.allocatedCapacity = allocatedCapacity;
            negative[prop].push(slot);

        }

        for (let [i, ds] of positiveParam[prop].entries()) {  //遍历每一个technicalUnit
            if (sumPS >= total) {
                break;
            }
            let allocatedCapacity = ds.technicalUnit.offeredCapacity;  //竞拍的电量
            if (allocatedCapacity > total - sumPS) {
                allocatedCapacity = (total * 100 - sumPS * 100) / 100;
            }
            sumPS += allocatedCapacity;
            let slot = factory.newConcept(NS, 'DistributionSlot');
            slot.technicalUnit = ds.technicalUnit;
            slot.allocatedCapacity = allocatedCapacity;
            positive[prop].push(slot);
        }

    }
    distribution.offer = distributionParam.offer;
    distribution.negative = negative;
    distribution.positive = positive;

    console.log(`add Distribution ${distributionParam.distributionId}`)
    let distributionRegistry = await getAssetRegistry(`${NS}.Distribution`);
    await distributionRegistry.add(distribution);
    // 完成分配电量事件
    console.log("emit DistributionCompletedEvent");
    let distributionCompletedEvent = factory.newEvent(NS, 'DistributionCompletedEvent');
    distributionCompletedEvent.distribution = factory.newRelationship(NS, 'Distribution', distributionParam.distributionId);
    emit(distributionCompletedEvent);


    //-------------------------------------------------------

    //计算PoolDistribution
    let poolDistribution = factory.newResource(NS, 'PoolDistribution', distribution.offer.demand.demandId);
    let poolPSumPS=0;
    let poolNGumNG=0;
    let poolPSArr = factory.newConcept(NS, 'TUSortedOffer6');
    let poolNGArr = factory.newConcept(NS, 'TUSortedOffer6');


    for (let prop of ONE_DAY_SLICES_6) {
        //从小到大排
        positive[prop].sort((slot1, slot2) => slot1.technicalUnit.energyPrice - slot2.technicalUnit.energyPrice);
        //从大到小排
        negative[prop].sort((slot1, slot2) => slot2.technicalUnit.energyPrice - slot1.technicalUnit.energyPrice);

        let winnerInfo = preparatoryList.negative[prop].find(info => info.offer.getIdentifier() == distribution.offer.offerId);
        let total = winnerInfo.allocatedCapacity / 100 * 110;

        poolPSArr[prop]=[]
        poolNGArr[prop]=[]

        for (let [i, ds] of positive[prop].entries()) {  //遍历每一个technicalUnit
            if (poolPSumPS >= total) {
                break;
            }
            let allocatedCapacity = ds.technicalUnit.offeredCapacity;  //竞拍的电量
            if (allocatedCapacity > total - poolPSumPS) {
                allocatedCapacity = (total * 100 - poolPSumPS * 100) / 100;
            }
            poolPSumPS += allocatedCapacity;
            let poolSlot = factory.newConcept(NS, 'TUWinnerInfo');
            poolSlot.technicalUnit = ds.technicalUnit;
            poolSlot.allocatedCapacity = allocatedCapacity;
            poolPSArr[prop].push(poolSlot);
        }

        for (let [i, ds] of negative[prop].entries()) {  //遍历每一个technicalUnit
            if (poolNGumNG >= total) {
                break;
            }
            let allocatedCapacity = ds.technicalUnit.offeredCapacity;  //竞拍的电量
            if (allocatedCapacity > total - poolNGumNG) {
                allocatedCapacity = (total * 100 - poolNGumNG * 100) / 100;
            }
            poolNGumNG += allocatedCapacity;
            let poolSlot = factory.newConcept(NS, 'TUWinnerInfo');
            poolSlot.technicalUnit = ds.technicalUnit;
            poolSlot.allocatedCapacity = allocatedCapacity;
            poolNGArr[prop].push(poolSlot);
        }
    }

    poolDistribution.positive = poolPSArr;
    poolDistribution.negative = poolNGArr;
    let poolDistributionRegistry = await getAssetRegistry(`${NS}.PoolDistribution`);
    await poolDistributionRegistry.add(poolDistribution);


    //-------------------------------------------------------
    //计算PoolPrep
    let poolPreparatory = factory.newResource(NS, 'PoolPreparatory', distribution.offer.demand.demandId);
    let poolPrePSumPS=0;
    let poolPrePSumNG=0;
    let poolPrePSArr = factory.newConcept(NS, 'TUSortedOffer6');
    let poolPreNGArr = factory.newConcept(NS, 'TUSortedOffer6');


    for (let prop of ONE_DAY_SLICES_6) {
        let winnerInfo = preparatoryList.negative[prop].find(info => info.offer.getIdentifier() == distribution.offer.offerId);
        let total = winnerInfo.allocatedCapacity;

        poolPrePSArr[prop]=[]
        poolPreNGArr[prop]=[]

        for (let [i, ds] of poolPSArr[prop].entries()) {  //遍历每一个technicalUnit
            if (poolPrePSumPS >= total) {
                break;
            }
            let allocatedCapacity = ds.technicalUnit.offeredCapacity;  //竞拍的电量
            if (allocatedCapacity > total - poolPrePSumPS) {
                allocatedCapacity = (total * 100 - poolPrePSumPS * 100) / 100;
            }
            poolPrePSumPS += allocatedCapacity;
            let poolSlot = factory.newConcept(NS, 'TUWinnerInfo');
            poolSlot.technicalUnit = ds.technicalUnit;
            poolSlot.allocatedCapacity = allocatedCapacity;
            poolPrePSArr[prop].push(poolSlot);
        }

        for (let [i, ds] of poolNGArr[prop].entries()) {  //遍历每一个technicalUnit
            if (poolPrePSumNG >= total) {
                break;
            }
            let allocatedCapacity = ds.technicalUnit.offeredCapacity;  //竞拍的电量
            if (allocatedCapacity > total - poolPrePSumNG) {
                allocatedCapacity = (total * 100 - poolPrePSumNG * 100) / 100;
            }
            poolPrePSumNG += allocatedCapacity;
            let poolSlot = factory.newConcept(NS, 'TUWinnerInfo');
            poolSlot.technicalUnit = ds.technicalUnit;
            poolSlot.allocatedCapacity = allocatedCapacity;
            poolPreNGArr[prop].push(poolSlot);
        }
    }
    poolPreparatory.positive = poolPrePSArr;
    poolPreparatory.negative = poolPreNGArr;
    let poolPreparatoryRegistry = await getAssetRegistry(`${NS}.PoolPreparatory`)
    await poolPreparatoryRegistry.add(poolPreparatory);
}


/**
 * DNO（DistributionNetworkOperator）根据上面的分配结果进行检验（这一步骤在simulink中完成），给出相应的结果。
 *
 * @param {org.control.reserve.platform.TestPowerFlowCalculation} tx
 * @transaction
 */
async function testPowerFlowCalculation(tx) {
    let powerFlowCalculationParam = tx.powerFlowCalculation;
    let poolParam = powerFlowCalculationParam.poolPreparatory;
    let negativeParam = tx.negative;
    let positiveParam = tx.positive;

    let testResults = [];

    for (let prop of ONE_DAY_SLICES_6) {
        for (let [i, testResult] of negativeParam[prop].entries()) {
            poolParam.negative[prop][i].testResult = testResult;
            testResults.push(testResult);
        }
    }

    for (let prop of ONE_DAY_SLICES_6) {
        for (let [i, testResult] of positiveParam[prop].entries()) {
            poolParam.positive[prop][i].testResult = testResult;
            testResults.push(testResult);
        }
    }

    let poolRegistry = await getAssetRegistry(`${NS}.PoolPreparatory`);
    poolRegistry.update(poolParam);

    let factory = getFactory();
    let powerFlowCalculation = factory.newResource(NS, 'PowerFlowCalculation', powerFlowCalculationParam.powerFlowCalculationId);

    powerFlowCalculation.poolPreparatory = poolParam;

    console.log("update registry: powerFlowCalculation");
    let powerFlowCalculationRegistry = await getAssetRegistry(`${NS}.PowerFlowCalculation`);
    await powerFlowCalculationRegistry.add(powerFlowCalculation);

    //如果调试的结果有fail，发送消息，提醒aggregator重新进行电量的分配
    //如果结果全部是pass，也发送消息，提醒aggregator分配方案可行
    if (testResults.every(testResult => testResult == TestResult.PASS)) {
        // 检验完成事件 PASS
        console.log("emit TestCompletedEvent PASS");
        let testCompletedEvent = factory.newEvent(NS, 'TestCompletedEvent');
        testCompletedEvent.poolPreparatory = factory.newRelationship(NS, 'PoolPreparatory', poolParam.demandId);
        testCompletedEvent.testResult = TestResult.PASS;
        emit(testCompletedEvent);
    } else {
        // 检验完成事件 FAIL
        console.log("emit TestCompletedEvent FAIL");
        let testCompletedEvent = factory.newEvent(NS, 'TestCompletedEvent');
        testCompletedEvent.poolPreparatory = factory.newRelationship(NS, 'PoolPreparatory', poolParam.demandId);
        testCompletedEvent.testResult = TestResult.FAIL;
        emit(testCompletedEvent);
    }
}


/**
 * TSO给出实际的调用结果（在simulink中按照DemandOffers进行调用）。
 * 15分钟给出一次调用结果
 *
 * @param {org.control.reserve.platform.ActivateSCR} tx
 * @transaction
 */
async function activateSCR(tx) {

    let activationParam = tx.activation;
    let offer_id = activationParam.offer.getIdentifier()
    let timeSlice = activationParam.timeSlice.match(/[0-9]+/ig).join('');
    let factory = getFactory();
    let offerNmae = offer_id + '-' + tx.timeInterval + '_' + timeSlice;

    let data = await getData(`/activate/${offer_id}/${tx.timeInterval + '_' + timeSlice}?type=${activationParam.productType}`);

    let inputSetValue = data.setValue;
    let inputActualValue = data.actualValue;

    let activation = factory.newResource(NS, 'Activation', activationParam.activationID);
    let amount16 = factory.newConcept(NS, 'Amount16');
    let offerData = factory.newResource(NS, 'OfferInputValue', offerNmae);

    let setCon = factory.newConcept(NS, 'Amount16Arr');
    let actualCon = factory.newConcept(NS, 'Amount16Arr');
    let upperCon = factory.newConcept(NS, 'Amount16Arr');
    let lowerCon = factory.newConcept(NS, 'Amount16Arr');
    let underCon = factory.newConcept(NS, 'Amount16Arr');


    let summaryOfSetValue = 0;
    let summaryOfActualValue = 0;
    let summaryOfUnderFulfillment = 0;


    SLICES16.forEach((item) => {
        setCon[item] = data.setValue[item];
        actualCon[item] = data.actualValue[item];
        upperCon[item] = data.upperLimit[item];
        lowerCon[item] = data.lowerLimit[item];
        underCon[item] = data.underFulfillment[item];


        summaryOfSetValue += data.setValue[item].reduce((total, next) => total + next, 0)
        summaryOfActualValue += data.actualValue[item].reduce((total, next) => total + next, 0)
        summaryOfUnderFulfillment += data.underFulfillment[item].reduce((total, next) => total + next, 0)

        let sum = 0;
        for (let i = 0; i < inputSetValue[item].length; i++) {
            if (activationParam.productType == ProductType.POSITIVE) {
                sum += Math.min(inputSetValue[item][i], inputActualValue[item][i])
            } else {
                sum += Math.max(inputSetValue[item][i], inputActualValue[item][i])
            }

        }
        amount16[item] = sum;
    });

    offerData.setValue = setCon;
    offerData.actualValue = actualCon;
    offerData.upperLimit = upperCon;
    offerData.lowerLimit = lowerCon;
    offerData.underFulfillment = underCon;
    offerData.summaryOfUnderFulfillment = summaryOfUnderFulfillment;
    offerData.summaryOfSetValue = summaryOfSetValue;
    offerData.summaryOfActualValue = summaryOfActualValue;


    activation.offer = activationParam.offer;
    activation.productType = activationParam.productType;
    activation.timeSlice = activationParam.timeSlice;
    activation.deployedControlEnergy = amount16;
    activation.deployedControlEnergyTotal = SLICES16.reduce((acc, cur) => acc + activation.deployedControlEnergy[cur], 0);


    console.log("update registry: activation");
    let aviationReg = await getAssetRegistry(`${NS}.Activation`);
    await aviationReg.add(activation);
    console.log("add inputValue");
    let offerReg = await getAssetRegistry(`${NS}.OfferInputValue`);
    await offerReg.add(offerData)

}


/**
 * Aggregator给出实际的调用结果（在simulink中按照result全部为pass的distribution进行调用）。
 * 15分钟调用一次
 *
 * @param {org.control.reserve.platform.DeployTechnicalUnits} tx
 * @transaction
 */
async function deployTechnicalUnits(tx) {

    let deploymentParam = tx.deployment;
    let tu_id = deploymentParam.technicalUnit.getIdentifier();
    let timeSlice = deploymentParam.timeSlice.match(/[0-9]+/ig).join('');
    let tuDataID = `${tu_id}-${tx.timeInterval + '_' + timeSlice}`;


    let data = await getData(`/technical/${tu_id}/${tx.timeInterval + '_' + timeSlice}`);


    let inputSetValue = data.setValue;
    let inputActualValue = data.actualValue;
    let factory = getFactory();
    let deploymentRegistry = await getAssetRegistry(`${NS}.Deployment`);
    let setActualInputValue = factory.newResource(NS, 'TUInputValue', tuDataID);
    let deployment = factory.newResource(NS, 'Deployment', deploymentParam.deploymentId);
    let amount16 = factory.newConcept(NS, 'Amount16');

    let setCon = factory.newConcept(NS, 'Amount16Arr');
    let actualCon = factory.newConcept(NS, 'Amount16Arr');
    let upperCon = factory.newConcept(NS, 'Amount16Arr');
    let lowerCon = factory.newConcept(NS, 'Amount16Arr');
    let underCon = factory.newConcept(NS, 'Amount16Arr');
    let acceptCon = factory.newConcept(NS, 'Amount16Arr');
    let allocCon = factory.newConcept(NS, 'Amount16Arr');
    let acceptTUCon = factory.newConcept(NS, 'Amount16Arr');
    let underTUCon = factory.newConcept(NS, 'Amount16Arr');



    deployment.poolPreparatory = deploymentParam.poolPreparatory;
    deployment.technicalUnit = deploymentParam.technicalUnit;
    deployment.productType = deploymentParam.productType;
    deployment.timeSlice = deploymentParam.timeSlice;


    let summaryOfSetValue = 0;
    let summaryOfActualValue = 0;
    let summaryOfUnderFulfillment = 0;


    SLICES16.forEach((item) => {
        setCon[item] = data.setValue[item];
        actualCon[item] = data.actualValue[item];
        upperCon[item] = data.upperLimit[item];
        lowerCon[item] = data.lowerLimit[item];
        underCon[item] = data.underFulfillment[item];
        acceptCon[item] = data.acceptanceValue[item];
        allocCon[item] = data.allocableAcceptanceValue[item];
        acceptTUCon[item] = data.acceptanceValueTU[item];
        underTUCon[item] = data.underFulfillmentTU[item];

        summaryOfSetValue += data.setValue[item].reduce((total, next) => total + next, 0)
        summaryOfActualValue += data.actualValue[item].reduce((total, next) => total + next, 0)
        summaryOfUnderFulfillment += data.underFulfillment[item].reduce((total, next) => total + next, 0)

        let sum = 0;
        for (let i = 0; i < inputSetValue[item].length; i++) {
            if (deploymentParam.productType == ProductType.POSITIVE) {
                sum += Math.min(inputSetValue[item][i], inputActualValue[item][i])
            } else {
                sum += Math.max(inputSetValue[item][i], inputActualValue[item][i])
            }

        }
        amount16[item] = sum;

    })

    setActualInputValue.setValue = setCon;
    setActualInputValue.actualValue = actualCon;
    setActualInputValue.upperLimit =upperCon;
    setActualInputValue.lowerLimit = lowerCon;
    setActualInputValue.underFulfillment = underCon;
    setActualInputValue.acceptanceValue = acceptCon;
    setActualInputValue.allocableAcceptanceValue = allocCon;
    setActualInputValue.acceptanceValueTU = acceptTUCon;
    setActualInputValue.underFulfillmentTU = underTUCon;
    setActualInputValue.proportion = data.proportion;
    setActualInputValue.summaryOfSetValue = summaryOfSetValue;
    setActualInputValue.summaryOfActualValue = summaryOfActualValue;
    setActualInputValue.summaryOfUnderFulfillment = summaryOfUnderFulfillment;

    deployment.deployedControlEnergy = amount16;
    // 累积每隔15分钟的deployedControlEnergy
    deployment.deployedControlEnergyTotal = SLICES16.reduce((acc, cur) => acc + deployment.deployedControlEnergy[cur], 0);

    console.log("update registry: Deployment");
    await deploymentRegistry.add(deployment);
    console.log("add inputValue");
    let tuInputReg = await getAssetRegistry(`${NS}.TUInputValue`)
    await tuInputReg.add(setActualInputValue);
}


/**
 * TSO根据上一个函数得到的调用结果进行盈利计算
 * 4个小时调用一次
 *
 * @param {org.control.reserve.platform.MakeRemuneration} tx -
 * @transaction
 */
async function makeRemuneration(tx) {
    let remunerationParam = tx.remuneration;
    let data = tx.offer_data;
    let setValue = data.setValue;
    let actualValue = data.actualValue;

    let factory = getFactory();
    let remuneration = factory.newResource(NS, 'Remuneration', remunerationParam.remunerationId);
    remuneration.activation = remunerationParam.activation;

    let offer = remuneration.activation.offer;
    let productType = remunerationParam.activation.productType;
    let timeSlice = remunerationParam.activation.timeSlice;
    let preparatoryListRegistry = await getAssetRegistry(`${NS}.PreparatoryList`);
    let preparatoryList = await preparatoryListRegistry.get(offer.demand.getIdentifier());


    let remunerationInfo = factory.newConcept(NS, 'RemunerationInfo');
    if (productType == ProductType.POSITIVE) {
        let winnerInfo = preparatoryList.positive[timeSlice].find(wi => wi.offer.getIdentifier() == offer.getIdentifier());
        remunerationInfo.remunerationProcuredControlEnergy = 4 * winnerInfo.allocatedCapacity * offer.positive.capacityPrice[timeSlice];
        //计算remunerationDeployedControlEnergy
        let sum = 0;
        SLICES16.forEach((item) => {
            let setValueArr = setValue[item];
            let actualValueArr = actualValue[item];
            sum += offer.positive.energyPrice[timeSlice] * (900 / 3600) * setValueArr.map((item, index) => item > actualValueArr[index] ? actualValueArr[index] : item).reduce((total, next) => {
                return total + next
            }, 0)
        })
        remunerationInfo.remunerationDeployedControlEnergy = sum;
        remunerationInfo.remuneration = remunerationInfo.remunerationProcuredControlEnergy + remunerationInfo.remunerationDeployedControlEnergy;
        remunerationInfo.energyPricePaymentDirection = EnergyPricePaymentDirection.GRID_TO_TECHNICAL_UNIT;

    } else if (productType == ProductType.NEGATIVE) {

        let winnerInfo = preparatoryList.negative[timeSlice].find(wi => wi.offer.getIdentifier() == offer.getIdentifier());
        remunerationInfo.remunerationProcuredControlEnergy = 4 * winnerInfo.allocatedCapacity * offer.positive.capacityPrice[timeSlice];

        let sum = 0;
        SLICES16.forEach((item) => {
            let setValueArr = setValue[item];
            let actualValueArr = actualValue[item];
            sum += offer.positive.energyPrice[timeSlice] * (900 / 3600) * setValueArr.map((item, index) => item < actualValueArr[index] ? actualValueArr[index] : item).reduce((total, next) => {
                return total + next
            }, 0)
        })
        remunerationInfo.remunerationDeployedControlEnergy = sum;
        remunerationInfo.remuneration = remunerationInfo.remunerationProcuredControlEnergy - remunerationInfo.remunerationDeployedControlEnergy;
        remunerationInfo.energyPricePaymentDirection = EnergyPricePaymentDirection.TECHNICAL_UNIT_TO_GRID;

    }

    remuneration.remunerationInfo = remunerationInfo;

    console.log("update registry: remuneration");
    let remunerationRegistry = await getAssetRegistry(`${NS}.Remuneration`)
    await remunerationRegistry.add(remuneration);

}

/**
 * Aggregator根据上一个函数得到的调用结果进行盈利计算
 * 4个小时调用一次
 *
 * @param {org.control.reserve.platform.AccountForTechnicalUnits} tx -
 * @transaction
 */
async function accountForTechnicalUnits(tx) {
    let remunerationParam = tx.remuneration;
    let data = tx.tu_data;
    let acceptanceValueTU = data.acceptanceValueTU;
    let underFulfillmentTU = data.underFulfillmentTU;

    let factory = getFactory();
    let remuneration = factory.newResource(NS, 'Accounting', remunerationParam.accountingId);
    remuneration.deployment = remunerationParam.deployment;

    let productType = remunerationParam.deployment.productType;
    let timeSlice = remunerationParam.deployment.timeSlice;

    let remunerationInfo = factory.newConcept(NS, 'RemunerationInfo');

    if (productType == ProductType.POSITIVE) {
        let slot = remuneration.deployment.poolPreparatory.positive[timeSlice].find(slot => slot.technicalUnit.getIdentifier() == remuneration.deployment.technicalUnit.getIdentifier());

        remunerationInfo.remunerationProcuredControlEnergy = 4 * slot.allocatedCapacity * slot.technicalUnit.capacityPrice;

        //计算remunerationDeployedControlEnergy
        let sum = 0;
        SLICES16.forEach((item) => {
            let profit = slot.technicalUnit.energyPrice * (900 / 3600) * acceptanceValueTU[item].reduce((total, next) => {
                return total + next
            }, 0)
            let penalty = slot.technicalUnit.energyPrice * (900 / 3600) * underFulfillmentTU[item].reduce((total, next) => {
                return total + next
            }, 0)
            sum += (profit - penalty)
        })
        remunerationInfo.remunerationDeployedControlEnergy = sum;
        remunerationInfo.remuneration = remunerationInfo.remunerationProcuredControlEnergy + remunerationInfo.remunerationDeployedControlEnergy;
        remunerationInfo.energyPricePaymentDirection = EnergyPricePaymentDirection.GRID_TO_TECHNICAL_UNIT;
    } else if (productType == ProductType.NEGATIVE) {
        let slot = remuneration.deployment.poolPreparatory.negative[timeSlice].find(slot => slot.technicalUnit.getIdentifier() == remuneration.deployment.technicalUnit.getIdentifier());

        remunerationInfo.remunerationProcuredControlEnergy = 4 * slot.allocatedCapacity * slot.technicalUnit.capacityPrice;
        //计算remunerationDeployedControlEnergy
        let sum = 0;
        SLICES16.forEach((item) => {
            let profit = slot.technicalUnit.energyPrice * (900 / 3600) * acceptanceValueTU[item].reduce((total, next) => {
                return total + next
            }, 0)
            let penalty = slot.technicalUnit.energyPrice * (900 / 3600) * underFulfillmentTU[item].reduce((total, next) => {
                return total + next
            }, 0)
            sum += (profit - penalty)
        })

        remunerationInfo.remuneration = remunerationInfo.remunerationProcuredControlEnergy - remunerationInfo.remunerationDeployedControlEnergy;
        remunerationInfo.energyPricePaymentDirection = EnergyPricePaymentDirection.TECHNICAL_UNIT_TO_GRID;
    }

    remuneration.remunerationInfo = remunerationInfo;
    console.log("update registry: accounting");
    let accountingRegistry = await getAssetRegistry(`${NS}.Accounting`)
    await accountingRegistry.add(remuneration);
}



