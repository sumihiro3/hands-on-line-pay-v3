const queryString = require('query-string');

let data = {}
// data.url = "https://web-pay.line.me/web/payment/wait?transactionReserveId=clExR0syaHRNRm9ZYWRaSUVBaHRRcHhtRW5jblRIR1U2cFpsaVhDY3M1SkxiRUNERE5kbWhtR3RTUlVJZ0s2SA&locale=ja_LP"
data.url = "https://google.com"
data.hoge = "fuga"

const stringfied = queryString.stringify(data)
console.log(stringfied)

const encodedUrl = "url=https%3A%2F%2Fweb-pay.line.me%2Fweb%2Fpayment%2Fwait%3FtransactionReserveId%3DclExR0syaHRNRm9ZYWRaSUVBaHRRcHhtRW5jblRIR1U2cFpsaVhDY3M1SkxiRUNERE5kbWhtR3RTUlVJZ0s2SA%26locale%3Dja_LP"
const decodedUrl = queryString.parse(encodedUrl)
console.log(decodedUrl.url)
