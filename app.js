const Koa = require('koa');
const router = require('./routes');
const cors = require('koa-cors');
const static = require('koa-static');

let app = new Koa();
app.use(static(__dirname+'/public/'));

app.use(cors());
// 配置静态web服务的中间件
app.use(router.routes())
    .use(router.allowedMethods());

app.listen(8088, function () {
    console.log('listen in 8088')
})
