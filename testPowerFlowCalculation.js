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
