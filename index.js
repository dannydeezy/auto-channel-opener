const lnService = require('ln-service')
const config = require('./config.json')
const fs = require('fs')
const axios = require('axios')

const { lnd } = lnService.authenticatedLndGrpc({
    cert: (config.TLS_CERT_FILE && fs.readFileSync(config.TLS_CERT_FILE)) || fs.readFileSync('/home/ubuntu/.lnd/tls.cert'),
    macaroon: (config.MACAROON_FILE && fs.readFileSync(config.MACAROON_FILE)) || fs.readFileSync(`/home/ubuntu/.lnd/data/chain/bitcoin/mainnet/admin.macaroon`),
    socket: config.SOCKET || `localhost:10009`,
});

const FEE_API = `https://whatthefee.io/data.json`
async function run() {
    // List unspents. If sum is greater than target channel size, open a channnel with the peer.
    const { utxos } = await lnService.getUtxos({ lnd, min_confirmations: config.MIN_CONFS })
    const utxoSumSats = utxos.reduce((acc, utxo) => acc + utxo.tokens, 0)
    console.log(`Total sats unspent: ${utxoSumSats}`)
    if (utxoSumSats < config.MIN_CHANNEL_SIZE_SATS) {
        return
    }
    const potentialChannelSizeSats = utxoSumSats - (config.RESERVE_ON_CHAIN_SATS || 0)
    if (potentialChannelSizeSats < config.MIN_CHANNEL_SIZE_SATS) {
        console.log(`potentialChannelSizeSats too small (${potentialChannelSizeSats} < ${config.MIN_CHANNEL_SIZE_SATS})`)
        return
    }
    console.log(`Opening channel`)
    let feeRateSatsPerVbyte = config.ON_CHAIN_SATS_PER_VBYTE
    if (!feeRateSatsPerVbyte) {
        const feeResponse = await axios.get(FEE_API).catch(err => {
            console.error(err)
            return null
        })
        if (!feeResponse || !feeResponse.data) return
        feeRateSatsPerVbyte = Math.ceil(Math.exp(feeResponse.data.data[0][3] / 100))
        console.log(`Get fee rate ${feeRateSatsPerVbyte} sats/vbyte`)
        if (feeRateSatsPerVbyte > 100) {
            throw new Error('Fee rate too high!!')
        }
    }
    if (!config.DRY_RUN) {
        const response = await lnService.openChannel({
            lnd,
            partner_public_key: config.PEER_PUBKEY,
            local_tokens: potentialChannelSizeSats,
            chain_fee_tokens_per_vbyte: feeRateSatsPerVbyte,
            min_confirmations: config.MIN_CONFS
        }).catch(err => {
            console.error(err)
            return null
        })
        if (!response) return
        console.log(response)
    }

}



const sleep = ms => new Promise(res => setTimeout(res, ms));

async function runLoop() {
    while (true) {
        await run()
        await sleep((config.PERIOD_SECONDS || 1) * 1000)
    }
}

runLoop()