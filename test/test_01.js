let arr = [{
    num:1
},{
    num:3
},{
    num:90
},{
    num:5
},{
    num:3
},{
    num:19
},{
    num:32
},{
    num:20
},{
    num:12
}]

arr.sort((pre,next)=>{
    return pre.num-next.num
})

console.log(arr)
