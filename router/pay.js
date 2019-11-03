"use strict";

require("dotenv").config();

const router = require("express").Router();
const uuid = require("uuid/v4");
const cache = require("memory-cache");
const debug = require("debug")("line-pay:pay");
const moment = require('moment')
const queryString = require("query-string")

// LINE Pay 側からのconfirmUrl へのリクエストを受け付ける
router.get("/confirm", (req, res, next) => {
    debug(`/pay/confirm called!`)
    const orderId = req.query.orderId
    const transactionId = req.query.transactionId
    let shippingFeeAmount = req.query.shippingFeeAmount
    if (!shippingFeeAmount) {
        shippingFeeAmount = 0
    }
    const shippingMethodId = req.query.shippingMethodId
    debug(`orderId is ${orderId}`)
    debug(`transactionId is ${transactionId}`)
    debug(`shippingFeeAmount is ${shippingFeeAmount}`)
    debug(`shippingMethodId is ${shippingMethodId}`)
    const key = `TRAN_${transactionId}`
    let transaction = cache.get(key);
    if (!transaction){
        throw new Error("Transaction not found.");
    }
    // Update Transaction info
    transaction.shippingFeeAmount = parseInt(shippingFeeAmount)
    transaction.shippingMethodId = shippingMethodId
    transaction.amount = transaction.amount + transaction.shippingFeeAmount
    cache.put(key, transaction)
    debug(`Retrieved following transaction.`);
    debug(transaction);
    // Call LINE Pay Confirm API
    let options = {
        transactionId: transactionId,
        amount: transaction.amount,
        currency: transaction.currency
    }
    debug(`Going to confirm payment with following options.`);
    debug(options);
    const pay = req.app.locals.pay
    pay.confirm(options).then((response) => {
        debug(`LINE Pay Confirm API Response: ${JSON.stringify(response)}`)
        // 決済完了とする
        transaction.status = "PAYMENT_DONE"
        cache.put(key, transaction)
        debug(`Paymente done: ${JSON.stringify(transaction)}`)
        // 領収書メッセージを返す
        const receiptMessage = generateReceiptMessage(transaction)
        const botClient = req.app.locals.botClient
        return botClient.pushMessage(transaction.userId, receiptMessage)
    }).catch((error) => {
        debug(`Error at LINE Pay Confirm API: ${error}`)
        res.status(500).send('NG')
    });
});

function generateReceiptMessage(transaction) {
    debug(`function generateReceiptMessage called!`)
    let messageText = "領収書"
    const transactionId = transaction.transactionId
    const totalAmount = `${transaction.amount} 円`
    const shippingFeeAmount = `${transaction.shippingFeeAmount} 円`
    const products = transaction.packages[0].products
    // お買い上げ商品のリスト
    const productRows = products.map(function (p) {
        let productRow = {
            "type": "box",
            "layout": "horizontal",
            "contents": [
                {
                    "type": "text",
                    "text": p.name,
                    "size": "sm",
                    "color": "#555555",
                    "flex": 0
                },
                {
                    "type": "text",
                    "text": `${p.price * p.quantity} 円`,
                    "size": "sm",
                    "color": "#111111",
                    "align": "end"
                }
            ]
        }
        return productRow
    })
    
    // 領収書メッセージ本体
    let bubble = {
        "type": "bubble",
        "body": {
            "type": "box",
            "layout": "vertical",
            "contents": [
                {
                    "type": "text",
                    "text": messageText,
                    "weight": "bold",
                    "color": "#1DB446",
                    "size": "sm"
                },
                {
                    "type": "text",
                    "text": "やさいマルシェ",
                    "weight": "bold",
                    "size": "xxl",
                    "margin": "md"
                },
                {
                    "type": "separator",
                    "margin": "xxl"
                },
                {
                    "type": "box",
                    "layout": "vertical",
                    "margin": "xxl",
                    "spacing": "sm",
                    "contents": productRows
                },
                {
                    "type": "box",
                    "layout": "vertical",
                    "margin": "xxl",
                    "spacing": "sm",
                    "contents": [
                        {
                            "type": "box",
                            "layout": "horizontal",
                            "contents": [
                                {
                                    "type": "text",
                                    "text": "送料",
                                    "size": "sm",
                                    "color": "#555555",
                                    "flex": 0
                                },
                                {
                                    "type": "text",
                                    "text": shippingFeeAmount,
                                    "size": "sm",
                                    "color": "#111111",
                                    "align": "end"
                                }
                            ]
                        }
                    ]
                },
                {
                    "type": "separator",
                    "margin": "xxl"
                },
                {
                    "type": "box",
                    "layout": "vertical",
                    "margin": "md",
                    "contents": [
                        {
                            "type": "box",
                            "layout": "horizontal",
                            "contents": [
                                {
                                    "type": "text",
                                    "text": "合計",
                                    "size": "md",
                                    "color": "#555555"
                                },
                                {
                                    "type": "text",
                                    "text": totalAmount,
                                    "size": "lg",
                                    "color": "#111111",
                                    "align": "end",
                                    "weight": "bold"
                                }
                            ]
                        }
                    ]
                },
                {
                    "type": "box",
                    "layout": "horizontal",
                    "margin": "md",
                    "contents": [
                        {
                            "type": "text",
                            "text": "PAYMENT ID",
                            "size": "xs",
                            "color": "#aaaaaa",
                            "flex": 0
                        },
                        {
                            "type": "text",
                            "text": transactionId,
                            "color": "#aaaaaa",
                            "size": "xs",
                            "align": "end"
                        }
                    ]
                }
            ]
        },
        "styles": {
            "footer": {
                "separator": true
            }
        }
    }
    const message = {
        "type": "flex",
        "altText": messageText,
        "contents": bubble
    }
    return message
}

router.get("/cancel", (req, res, next) => {
    debug(`/pay/cancel called!: ${req}`);
});

router.post("/shipping_methods", (req, res, next) => {
    debug(`/pay/shipping_methods called!`)
    debug(`req.body: ${JSON.stringify(req.body)}`)
    // 配送日を2日後に設定
    const deliveryDate = moment().add(2, 'days')
    const dt = deliveryDate.format("YYYYMMDD")
    let response = {
        "returnCode": "0000",
        "returnMessage": "OK",
        "info": {
            "shippingMethods":[
                {
                    "id": "shipping_01",
                    "name": "シロイヌホクト",
                    "amount": 2,
                    "toDeliveryYmd": dt
                },
                {
                    "id": "shipping_02",
                    "name": "馬車便",
                    "amount": 1,
                    "toDeliveryYmd": dt
                }
            ] 
        }
    }
    res.json(response)
});

module.exports = router;
