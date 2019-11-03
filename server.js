"use strict";

require("dotenv").config();

const app = require("express")();
const debug = require("debug")("line-pay:root");

app.listen(process.env.PORT || 5000, () => {
    debug(`server is listening to ${process.env.PORT || 5000}...`);
});

// LINE Pay API SDK の初期化
const line_pay = require("./line-pay/line-pay")
debug(`useCheckout: ${process.env.LINE_PAY_USE_CHECKOUT}`)
const useCheckout = process.env.LINE_PAY_USE_CHECKOUT === "true" ? true : false
const pay = new line_pay({
    channelId: process.env.LINE_PAY_CHANNEL_ID,
    channelSecret: process.env.LINE_PAY_CHANNEL_SECRET,
    isSandbox: !useCheckout
});
app.locals.pay = pay
app.locals.useCheckout = useCheckout

// LINE Messaging API SDK　の初期化
const lineBot = require("@line/bot-sdk");
const botConfig = {
    channelAccessToken: process.env.LINE_BOT_ACCESS_TOKEN,
    channelSecret: process.env.LINE_BOT_CHANNEL_SECRET
}
const botClient = new lineBot.Client(botConfig)
app.locals.botClient = botClient

app.get("/", (req, res, next) => {
    debug(`Root called!: ${req}`);
    res.send({
        message: 'Hello LINE Pay Bot!'
    })
});

const botRouter = require("./router/bot");
app.use("/bot", botRouter);
const payRouter = require("./router/pay");
app.use("/pay", payRouter);
