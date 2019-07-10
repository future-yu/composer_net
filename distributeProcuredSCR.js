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
    distribution.offer = distributionParam.offer;

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
    let poolDistribution = factory.newResource(NS, 'PoolDistribution',`${distributionParam.distributionId}_PoolDistribution`);
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
    //计算PoolPreparatory
    let poolPreparatory = factory.newResource(NS, 'PoolPreparatory', `${distributionParam.distributionId}_PoolPreparatory`);
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
