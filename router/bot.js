"use strict";

require("dotenv").config();

const app = require("express")();
const router = require("express").Router();
const uuid = require("uuid/v4");
const cache = require("memory-cache");
const debug = require("debug")("line-pay:bot");
const fs = require("fs");
const queryString = require('query-string');

// LINE Messaging API SDK　の初期化
const lineBot = require("@line/bot-sdk");
const botConfig = {
    channelAccessToken: process.env.LINE_BOT_ACCESS_TOKEN,
    channelSecret: process.env.LINE_BOT_CHANNEL_SECRET
}
const botMiddleware = lineBot.middleware(botConfig)
const botClient = new lineBot.Client(botConfig)

const APP_HOST_NAME = process.env.APP_HOST_NAME

const KEYWORD_SHOW_ITEM_MESSAGE = "アイテム"
const KEYWORD_SHOW_CART_MESSAGE = "カート"

const PAY_PRODUCT_NAME = "やさいマルシェ"
const PAY_SHIPPING_FEE = 0

const ITEM_FLEX_MESSAGE_JSON = "./router/item_flex_message.json"
const ITEMS = JSON.parse(fs.readFileSync("./data/items.json", "utf8"));

// LINE Bot でのLINE 側からのWebhook を受け付ける
router.post("/", botMiddleware, (req, res, next) => {
    debug(`bot router "/" called!!`);
    debug(`app.locals.hoge: ${req.app.locals.hoge}`);
    debug(`req.body: ${JSON.stringify(req.body)}`);
    debug(`req.body.events: ${JSON.stringify(req.body.events)}`);
    res.sendStatus(200);
    // Event情報ごとに処理をする
    req.body.events.map(async (event) => {
        // 接続確認の場合は無視する
        debug(`Event: ${JSON.stringify(event)}`);
        if (event.replyToken == "00000000000000000000000000000000" || event.replyToken == "ffffffffffffffffffffffffffffffff") {
            debug(`Had Connection check!!`);
            return;
        }
        const userId = event.source.userId
        let replyMessage = {
            "type": "text",
            "text": "Oh no..."
        }
        // "アイテム"というテキストメッセージが来たら商品一覧のメッセージを返す
        if (event.type === "message") {
            const messageText = event.message.text
            if (messageText === KEYWORD_SHOW_ITEM_MESSAGE) {
                replyMessage = generateItemsMessage()
            } else if (messageText === KEYWORD_SHOW_CART_MESSAGE) {
                replyMessage = generateCartMessage(userId)
            }
        } else if (event.type === "postback") {
            const postbackData = event.postback.data
            const parsedData = queryString.parse(postbackData)
            debug(`Postback data: ${JSON.stringify(parsedData)}`)
            debug(`Postback data: ${parsedData.type}`)
            if (parsedData.type === "order") {
                replyMessage = addToCart(userId, parsedData)
            } else if (parsedData.type === "reset") {
                replyMessage = resetUserCart(userId)
            } else if (parsedData.type === "pay") {
                const pay = req.app.locals.pay
                const useCheckout = req.app.locals.useCheckout
                replyMessage = await doPayRequest(event, userId, pay, useCheckout)
            }
        }
        if (replyMessage) {
            return botClient.replyMessage(event.replyToken, replyMessage)
        }
    });
});

// 商品選択用メッセージを生成する
function generateItemsMessage() {
    debug(`generateItemsMessage function called!`)
    const messageJson = JSON.parse(fs.readFileSync(ITEM_FLEX_MESSAGE_JSON, "utf8"))
    const message = {
        "type": "flex",
        "altText": "商品と個数を選んでください",
        "contents": messageJson
    }
    return message
}

// カートに注文商品情報を登録する
function addToCart(userId, postbackData) {
    debug(`handleOrder function called!: ${userId}; ${JSON.stringify(postbackData)}`)
    // OrderItem 情報の生成
    const orderItem = {
        item: postbackData.item,
        name: findItemName(postbackData.item),
        unitPrice: parseInt(postbackData.unit_price),
        quantity: parseInt(postbackData.quantity),
    }
    let items = getCartItems(userId)
    // 同じ商品がカートに入っていたらマージ
    const sameItems = items.filter(function (item, index, array) {
        let merged = false
        if (item.item === orderItem.item) {
            item.quantity = item.quantity + orderItem.quantity
            array[index] = item
            merged = true
        }
        return merged
    })
    if (sameItems.length === 0) {
        items.push(orderItem)
    }
    // カートに保存
    const key = `CART_${userId}`
    cache.put(key, items)
    // Cart message
    return generateCartMessage(userId)
}

// ユーザーがカートに入れている商品の情報を取得する
function getCartItems(userId) {
    debug(`getCartItems function called!: ${userId}`)
    const key = `CART_${userId}`
    let items = cache.get(key)
    if (!items) {
        items = []
    }
    return items
}

// ユーザーのカートの中身を削除する
function resetUserCart(userId) {
    debug(`resetUserCart function called!: ${userId}`)
    const key = `CART_${userId}`
    cache.del(key)
    return {
        "type": "text",
        "text": "カートの中身を削除しました"
    }
}

// カート商品内の代金合計を計算する
function calcCartTotalPrice(userId) {
    debug(`calcCartTotalPrice function called!: ${userId}`)
    const items = getCartItems(userId)
    let totalPrice = 0
    items.forEach(function (item) {
        totalPrice = totalPrice + (item.unitPrice * item.quantity)
    });
    totalPrice += PAY_SHIPPING_FEE
    return totalPrice
}

// カート商品表示用メッセージを生成する
function generateCartMessage(userId) {
    debug(`generateCartMessage function called!: ${userId}`)
    const items = getCartItems(userId)
    let message = {
        "type": "text",
        "text": "カートに商品が入っていません"
    }
    // Cart message
    if (items.length > 0) {
        let totalPrice = calcCartTotalPrice(userId)
        totalPrice = `${totalPrice} 円`
        const cartItems = items.map(function (item) {
            let price = `${item.unitPrice * item.quantity} 円`
            let itemLabel = `${item.name} [${item.unitPrice}円 × ${item.quantity}個]`
            let cartItem = {
                "type": "box",
                "layout": "horizontal",
                "contents": [
                    {
                        "type": "text",
                        "text": itemLabel,
                        "size": "sm",
                        "color": "#555555",
                        "flex": 0
                    },
                    {
                        "type": "text",
                        "text": price,
                        "size": "sm",
                        "color": "#111111",
                        "align": "end"
                    }
                ]
            }
            return cartItem
        })
        const cartMessage = {
            "type": "bubble",
            "body": {
                "type": "box",
                "layout": "vertical",
                "contents": [
                    {
                        "type": "text",
                        "text": "CART",
                        "weight": "bold",
                        "color": "#1DB446",
                        "size": "lg"
                    },
                    {
                        "type": "box",
                        "layout": "vertical",
                        "margin": "xxl",
                        "spacing": "sm",
                        "contents": cartItems
                    },
                    {
                        "type": "box",
                        "layout": "vertical",
                        "margin": "xxl",
                        "spacing": "sm",
                        "contents": [
                            {
                                "type": "separator",
                                "margin": "xxl"
                            },
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
                                        "text": totalPrice,
                                        "size": "lg",
                                        "weight": "bold",
                                        "color": "#111111",
                                        "align": "end"
                                    }
                                ],
                                "margin": "md"
                            }
                        ]
                    }
                ]
            },
            "footer": {
                "type": "box",
                "layout": "vertical",
                "contents": [
                    {
                        "type": "box",
                        "layout": "horizontal",
                        "contents": [
                            {
                                "type": "button",
                                "action": {
                                    "type": "message",
                                    "label": "買物を続ける",
                                    "text": "アイテム"
                                },
                                "style": "primary",
                                "color": "#cccccc"
                            },
                            {
                                "type": "button",
                                "action": {
                                    "type": "postback",
                                    "label": "削除",
                                    "data": "type=reset",
                                    "displayText": "カートの中身を削除"
                                }
                            }
                        ]
                    },
                    {
                        "type": "button",
                        "action": {
                            "type": "postback",
                            "label": "レジに進む",
                            "data": "type=pay",
                            "displayText": "レジに進む"
                        },
                        "margin": "xl",
                        "style": "secondary",
                        "color": "#1DB446"
                    }
                ]
            },
            "styles": {
                "footer": {
                    "separator": true
                }
            }
        }
        message = {
            "type": "flex",
            "altText": "カート",
            "contents": cartMessage
        }
    }
    return message
}

function findItemName(itemId) {
    debug(`findItemName function called!: ${itemId}`)
    const result = ITEMS.filter(function (item) {
        return item.id === itemId
    })
    return result[0]["name"]
}

function findItemImageUrl(itemId) {
    debug(`findItemImageUrl function called!: ${itemId}`)
    const result = ITEMS.filter(function (item) {
        return item.id === itemId
    })
    return result[0]["image"]
}

// 注文情報を生成しLINE Pay Request API を実行して決済処理を始める
async function doPayRequest(event, userId, pay, useCheckout) {
    debug(`doPayRequest function called!: ${userId}`)
    const totalPrice = calcCartTotalPrice(userId)
    const items = getCartItems(userId)
    const products = items.map(function (item) {
        // 決済する商品情報を生成する
        const product = {
            id: item.item,
            name: item.name,
            imageUrl: findItemImageUrl(item.item),
            quantity: item.quantity,
            price: item.unitPrice
        }
        debug(`Product: ${JSON.stringify(product)}`)
        return product
    })
    const packages = [
        {
            id: "package_id",
            amount: totalPrice,
            name: PAY_PRODUCT_NAME,
            products: products
        }
    ]
    const orderId = uuid()
    let options = {
        amount: totalPrice,
        currency: "JPY",
        orderId: orderId,
        packages: packages,
        redirectUrls: {
            confirmUrl: `https://${APP_HOST_NAME}/pay/confirm`,
            confirmUrlType: "SERVER",
            cancelUrl: `https://${APP_HOST_NAME}/pay/cancel`,
        },
        options: {
            display: {
                locale: "ja",
                checkConfirmUrlBrowser: false
            },
            payment: {
                capture: true
            }
        }
    }
    if (useCheckout === true) {
        options.options.shipping = {
            type: "SHIPPING",
            feeInquiryUrl: `https://${APP_HOST_NAME}/pay/shipping_methods`,
            feeInquiryType: "CONDITION",
        }
    }
    debug(`Call LINE Pay Request API!!`);
    debug(`LINE Pay Request API Parameters : ${JSON.stringify(options)}`);
    let replyMessage = {
        "type": "text",
        "text": "決済処理が失敗しました。もう一度、お試しください。"
    }
    await pay.request(options).then((response) => {
        let reservation = options
        reservation.userId = userId
        reservation.transactionId = response.info.transactionId
        reservation.status = "RESERVED"
        // API Result
        debug(`Return code: ${response.returnCode}`);
        debug(`Return message: ${response.returnMessage}`);
        debug(`Reservation was made. Detail is following.`);
        debug(reservation);
        // Save transaction information
        const transactionKey = `TRAN_${reservation.transactionId}`
        cache.put(transactionKey, reservation)
        // Reset user cart
        resetUserCart(userId)
        // LINE Pay 決済用メッセージをリプライ送信する
        replyMessage = generatePayMessage(
            reservation.transactionId,
            reservation,
            response.info.paymentUrl.web)
        
    }).catch((error) => {
        // error
        debug(`Error at LINE Pay Request API...: ${error}`)
    });
    return replyMessage
}

// 決済開始用メッセージを生成する
function generatePayMessage(transactionId, reservation, paymentUrl) {
    debug(`generatePayMessage function called!: ${transactionId}; ${JSON.stringify(reservation)}`)
    const products = reservation.packages[0].products
    debug(`products: ${JSON.stringify(products)}`)
    // Payment message
    let totalPrice = `${reservation.amount} 円`
    let messageText = PAY_PRODUCT_NAME + "の商品を購入するには下記のボタンで決済に進んでください"
    let params = {
        url: paymentUrl
    }
    const productRows = products.map(function (item) {
        let price = `${item.price * item.quantity} 円`
        let itemLabel = `${item.name} [${item.price}円 × ${item.quantity}個]`
        let productRow = {
            "type": "box",
            "layout": "horizontal",
            "contents": [
                {
                    "type": "text",
                    "text": itemLabel,
                    "size": "sm",
                    "color": "#555555",
                    "flex": 0
                },
                {
                    "type": "text",
                    "text": price,
                    "size": "sm",
                    "color": "#111111",
                    "align": "end"
                }
            ]
        }
        return productRow
    })
    const payMessage = {
        "type": "bubble",
        "header": {
            "type": "box",
            "layout": "vertical",
            "contents": [
                {
                    "type": "text",
                    "text": "レジ",
                    "weight": "bold",
                    "color": "#1DB446",
                    "size": "lg"
                }
            ]
        },
        "hero": {
            "type": "image",
            "url": "https://illustimage.com/photo/dl/6604.png?20180801",
            "size": "4xl",
            "aspectRatio": "1:1",
            "aspectMode": "cover"
        },
        "body": {
            "type": "box",
            "layout": "vertical",
            "contents": [
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
                            "type": "separator",
                            "margin": "xxl"
                        },
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
                                    "text": totalPrice,
                                    "size": "lg",
                                    "weight": "bold",
                                    "color": "#111111",
                                    "align": "end"
                                }
                            ],
                            "margin": "md"
                        }
                    ]
                }
            ]
        },
        "footer": {
            "type": "box",
            "layout": "vertical",
            "contents": [
                {
                    "type": "text",
                    "text": messageText,
                    "wrap": true,
                    "size": "sm",
                    "color": "#666666"
                },
                {
                    "type": "button",
                    "style": "primary",
                    "height": "sm",
                    "margin": "xl",
                    "action": {
                        "type": "uri",
                        "label": "LINE Payで決済",
                        "uri": paymentUrl
                    }
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
        "contents": payMessage
    }
    return message
}

module.exports = router;
