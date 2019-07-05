const Routes = require('koa-router');
const fs = require('fs')
const path = require('path')

let router = new Routes();

const file_name = {
    '000_015':'from000To015',
    '015_030':'from015To030',
    '030_045':'from030To045',
    '045_060':'from045To060',
    '060_075':'from060To075',
    '075_090':'from075To090',
    '090_105':'from090To105',
    '105_120':'from105To120',
    '120_135':'from120To135',
    '135_150':'from135To150',
    '150_165':'from150To165',
    '165_180':'from165To180',
    '180_195':'from180To195',
    '195_210':'from195To210',
    '210_225':'from210To225',
    '225_240':'from225To240'
};

function getData(data_path) {
    let data={};
    let fileNameArr = fs.readdirSync(data_path);
    fileNameArr.forEach((item)=>{
        let data_name = item.split('.')[0];
        data[file_name[data_name]]=fs.readFileSync(path.join(data_path,item)).toString().trim().split(',').map((item)=>{
            return parseFloat(item)
        });
    });
    return data;
}

// let test_path = path.join(__dirname, `./Daten/Offer/Offer_001/SetValue/NG_2019_0630_0004`)
// let data = getData(test_path)

router.get('/activate/:offer_id/:time', async function (ctx, next) {
    let type = ctx.request.query.type;
    if(type=='POSITIVE'){
        type='PS';
    }else{
        type='NG';
    }
    let {offer_id, time} = ctx.params;
    let setValuePath = path.join(__dirname, `./Daten/Offer/${offer_id}/SetValue/${type}_${time}`)
    let actualValuePath = path.join(__dirname, `./Daten/Offer/${offer_id}/ActualValue/${type}_${time}`)
    let upperPath = path.join(__dirname, `./Daten/Offer/${offer_id}/UpperLimit/${type}_${time}`);
    let lowerPath = path.join(__dirname, `./Daten/Offer/${offer_id}/LowerLimit/${type}_${time}`);
    let underPath = path.join(__dirname, `./Daten/Offer/${offer_id}/UnderFulfillment/${type}_${time}`);

    let allSetArr = getData(setValuePath);
    let allActualArr = getData(actualValuePath);
    let upperArr = getData(upperPath)
    let lowerArr = getData(lowerPath)
    let underArr = getData(underPath)

    ctx.type = 'application/json';
    ctx.body = JSON.stringify({
        setValue: allSetArr,
        actualValue: allActualArr,
        upperLimit:upperArr,
        lowerLimit:lowerArr,
        underFulfillment:underArr
    })
});


router.get('/technical/:tu_id/:time', async function (ctx, next) {
    let {tu_id, time} = ctx.params;
    let type = ctx.request.query.type;
    if(type=='POSITIVE'){
        type='PS';
    }else{
        type='NG';
    }

    let setValuePath = path.join(__dirname, `./Daten/TechnicalUnit/${tu_id}/SetValue/${type}_${time}`)
    let actualValuePath = path.join(__dirname, `./Daten/TechnicalUnit/${tu_id}/ActualValue/${type}_${time}`)
    let upperPath = path.join(__dirname, `./Daten/TechnicalUnit/${tu_id}/UpperLimit/${type}_${time}`);
    let lowerPath = path.join(__dirname, `./Daten/TechnicalUnit/${tu_id}/LowerLimit/${type}_${time}`);
    let underPath = path.join(__dirname, `./Daten/TechnicalUnit/${tu_id}/UnderFulfillment/${type}_${time}`);
    let acceptPath = path.join(__dirname, `./Daten/TechnicalUnit/${tu_id}/AcceptanceValue/${type}_${time}`);
    let acceptTUPath = path.join(__dirname, `./Daten/TechnicalUnit/${tu_id}/AcceptanceValueTU/${type}_${time}`);
    let allocPath = path.join(__dirname, `./Daten/TechnicalUnit/${tu_id}/AllocableAcceptanceValue/${type}_${time}`);
    let underTUPath = path.join(__dirname, `./Daten/TechnicalUnit/${tu_id}/UnderFulfillmentTU/${type}_${time}`);
    let proportionPath = path.join(__dirname, `./Daten/TechnicalUnit/Proportion/${time}.json`);

    let allSetArr = getData(setValuePath);
    let allActualArr = getData(actualValuePath);
    let upperArr = getData(upperPath)
    let lowerArr = getData(lowerPath)
    let underArr = getData(underPath)

    let acceptArr = getData(acceptPath)
    let acceptTUArr = getData(acceptTUPath)
    let allocArr = getData(allocPath)
    let underTUArr = getData(underTUPath)

    let proportionData = JSON.parse(fs.readFileSync(proportionPath).toString());

    ctx.type = 'application/json';
    ctx.body = JSON.stringify({
        setValue: allSetArr,
        actualValue: allActualArr,
        upperLimit: upperArr,
        lowerLimit:lowerArr,
        underFulfillment:underArr,
        acceptanceValue:acceptArr,
        allocableAcceptanceValue:acceptTUArr,
        acceptanceValueTU:allocArr,
        underFulfillmentTU:underTUArr,
        proportion:type=='PS'?proportionData['positive']:proportionData['negative']
    })
});


module.exports = router;
