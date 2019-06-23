'use strict'

const crypto = require('crypto')
const bech32 = require('bech32')
const secp256k1 = require('secp256k1')
const Buffer = require('safe-buffer').Buffer
const BN = require('bn.js')
const bitcoinjsAddress = require('bitcoinjs-lib/src/address')
const cloneDeep = require('lodash/cloneDeep')
const coininfo = require('coininfo')

// const BITCOINJS_NETWORK_INFO = {
//   bitcoin: coininfo.bitcoin.main.toBitcoinJS(),
//   testnet: coininfo.bitcoin.test.toBitcoinJS(),
//   regtest: coininfo.bitcoin.regtest.toBitcoinJS(),
//   litecoin: coininfo.litecoin.main.toBitcoinJS(),
//   litecoin_testnet: coininfo.litecoin.test.toBitcoinJS()
// }
// BITCOINJS_NETWORK_INFO.bitcoin.bech32 = 'bc'
// BITCOINJS_NETWORK_INFO.testnet.bech32 = 'tb'
// BITCOINJS_NETWORK_INFO.regtest.bech32 = 'bcrt'
// BITCOINJS_NETWORK_INFO.litecoin.bech32 = 'ltc'
// BITCOINJS_NETWORK_INFO.litecoin_testnet.bech32 = 'tltc'

// defaults for encode; default timestamp is current time at call
// const DEFAULTNETWORK = BITCOINJS_NETWORK_INFO[DEFAULTNETWORKSTRING]
const DEFAULTEXPIRETIME = 3600
const DEFAULTCLTVEXPIRY = 9
const DEFAULTDESCRIPTION = ''

const VALIDWITNESSVERSIONS = [0]

const DIVISORS = {
  m: new BN(1e3, 10),
  u: new BN(1e6, 10),
  n: new BN(1e9, 10),
  p: new BN(1e12, 10)
}

const MAX_MILLISATS = new BN('2100000000000000000', 10)

const MILLISATS_PER_BTC = new BN(1e11, 10)
const MILLISATS_PER_MILLIBTC = new BN(1e8, 10)
const MILLISATS_PER_MICROBTC = new BN(1e5, 10)
const MILLISATS_PER_NANOBTC = new BN(1e2, 10)
const PICOBTC_PER_MILLISATS = new BN(10, 10)

const TAGCODES = {
  description: 13,
  payee_node_key: 19,
  expire_time: 6, // default: 3600 (1 hour)
}

// reverse the keys and values of TAGCODES and insert into TAGNAMES
const TAGNAMES = {}
for (let i = 0, keys = Object.keys(TAGCODES); i < keys.length; i++) {
  let currentName = keys[i]
  let currentCode = TAGCODES[keys[i]].toString()
  TAGNAMES[currentCode] = currentName
}

const TAGENCODERS = {
  payment_hash: hexToWord, // 256 bits
  description: textToWord, // string variable length
  payee_node_key: hexToWord, // 264 bits
  purpose_commit_hash: purposeCommitEncoder, // 256 bits
  expire_time: intBEToWords, // default: 3600 (1 hour)
  min_final_cltv_expiry: intBEToWords, // default: 9
  fallback_address: fallbackAddressEncoder,
  routing_info: routingInfoEncoder // for extra routing info (private etc.)
}

const TAGPARSERS = {
  '13': (words) => wordsToBuffer(words, true).toString('utf8'), // string variable length
  '19': (words) => wordsToBuffer(words, true).toString('hex'), // 264 bits
  '6': wordsToIntBE, // default: 3600 (1 hour)
}

const unknownTagName = 'unknownTag'

function unknownEncoder (data) {
  data.words = bech32.decode(data.words, Number.MAX_SAFE_INTEGER).words
  return data
}

function getUnknownParser (tagCode) {
  return (words) => ({
    tagCode: parseInt(tagCode),
    words: bech32.encode('unknown', words, Number.MAX_SAFE_INTEGER)
  })
}

function wordsToIntBE (words) {
  return words.reverse().reduce((total, item, index) => {
    return total + item * Math.pow(32, index)
  }, 0)
}

function intBEToWords (intBE, bits) {
  let words = []
  if (bits === undefined) bits = 5
  intBE = Math.floor(intBE)
  if (intBE === 0) return [0]
  while (intBE > 0) {
    words.push(intBE & (Math.pow(2, bits) - 1))
    intBE = Math.floor(intBE / Math.pow(2, bits))
  }
  return words.reverse()
}

function sha256 (data) {
  return crypto.createHash('sha256').update(data).digest()
}

function convert (data, inBits, outBits) {
  let value = 0
  let bits = 0
  let maxV = (1 << outBits) - 1

  let result = []
  for (let i = 0; i < data.length; ++i) {
    value = (value << inBits) | data[i]
    bits += inBits

    while (bits >= outBits) {
      bits -= outBits
      result.push((value >> bits) & maxV)
    }
  }

  if (bits > 0) {
    result.push((value << (outBits - bits)) & maxV)
  }

  return result
}

function wordsToBuffer (words, trim) {
  let buffer = Buffer.from(convert(words, 5, 8, true))
  if (trim && words.length * 5 % 8 !== 0) {
    buffer = buffer.slice(0, -1)
  }
  return buffer
}

function hexToBuffer (hex) {
  if (hex !== undefined &&
      (typeof hex === 'string' || hex instanceof String) &&
      hex.match(/^([a-zA-Z0-9]{2})*$/)) {
    return Buffer.from(hex, 'hex')
  }
  return hex
}

function textToBuffer (text) {
  return Buffer.from(text, 'utf8')
}

function hexToWord (hex) {
  let buffer = hexToBuffer(hex)
  return bech32.toWords(buffer)
}

function textToWord (text) {
  let buffer = textToBuffer(text)
  let words = bech32.toWords(buffer)
  return words
}

// see encoder for details
function fallbackAddressParser (words, network) {
  let version = words[0]
  words = words.slice(1)

  let addressHash = wordsToBuffer(words, true)

  let address = null

  switch (version) {
    case 17:
      address = bitcoinjsAddress.toBase58Check(addressHash, network.pubKeyHash)
      break
    case 18:
      address = bitcoinjsAddress.toBase58Check(addressHash, network.scriptHash)
      break
    case 0:
      address = bitcoinjsAddress.toBech32(addressHash, version, network.bech32)
      break
  }

  return {
    code: version,
    address,
    addressHash: addressHash.toString('hex')
  }
}

// the code is the witness version OR 17 for P2PKH OR 18 for P2SH
// anything besides code 17 or 18 should be bech32 encoded address.
// 1 word for the code, and right pad with 0 if necessary for the addressHash
// (address parsing for encode is done in the encode function)
function fallbackAddressEncoder (data, network) {
  return [data.code].concat(hexToWord(data.addressHash))
}

// first convert from words to buffer, trimming padding where necessary
// parse in 51 byte chunks. See encoder for details.
function routingInfoParser (words) {
  let routes = []
  let pubkey, shortChannelId, feeBaseMSats, feeProportionalMillionths, cltvExpiryDelta
  let routesBuffer = wordsToBuffer(words, true)
  while (routesBuffer.length > 0) {
    pubkey = routesBuffer.slice(0, 33).toString('hex') // 33 bytes
    shortChannelId = routesBuffer.slice(33, 41).toString('hex') // 8 bytes
    feeBaseMSats = parseInt(routesBuffer.slice(41, 45).toString('hex'), 16) // 4 bytes
    feeProportionalMillionths = parseInt(routesBuffer.slice(45, 49).toString('hex'), 16) // 4 bytes
    cltvExpiryDelta = parseInt(routesBuffer.slice(49, 51).toString('hex'), 16) // 2 bytes

    routesBuffer = routesBuffer.slice(51)

    routes.push({
      pubkey,
      short_channel_id: shortChannelId,
      fee_base_msat: feeBaseMSats,
      fee_proportional_millionths: feeProportionalMillionths,
      cltv_expiry_delta: cltvExpiryDelta
    })
  }
  return routes
}

// routing info is encoded first as a large buffer
// 51 bytes for each channel
// 33 byte pubkey, 8 byte short_channel_id, 4 byte millisatoshi base fee (left padded)
// 4 byte fee proportional millionths and a 2 byte left padded CLTV expiry delta.
// after encoding these 51 byte chunks and concatenating them
// convert to words right padding 0 bits.
function routingInfoEncoder (datas) {
  let buffer = Buffer.from([])
  datas.forEach(data => {
    buffer = Buffer.concat([buffer, hexToBuffer(data.pubkey)])
    buffer = Buffer.concat([buffer, hexToBuffer(data.short_channel_id)])
    buffer = Buffer.concat([buffer, Buffer.from([0, 0, 0].concat(intBEToWords(data.fee_base_msat, 8)).slice(-4))])
    buffer = Buffer.concat([buffer, Buffer.from([0, 0, 0].concat(intBEToWords(data.fee_proportional_millionths, 8)).slice(-4))])
    buffer = Buffer.concat([buffer, Buffer.from([0].concat(intBEToWords(data.cltv_expiry_delta, 8)).slice(-2))])
  })
  return hexToWord(buffer)
}

// if text, return the sha256 hash of the text as words.
// if hex, return the words representation of that data.
function purposeCommitEncoder (data) {
  let buffer
  if (data !== undefined && (typeof data === 'string' || data instanceof String)) {
    if (data.match(/^([a-zA-Z0-9]{2})*$/)) {
      buffer = Buffer.from(data, 'hex')
    } else {
      buffer = sha256(Buffer.from(data, 'utf8'))
    }
  } else {
    throw new Error('purpose or purpose commit must be a string or hex string')
  }
  return bech32.toWords(buffer)
}

function tagsItems (tags, tagName) {
  let tag = tags.filter(item => item.tagName === tagName)
  let data = tag.length > 0 ? tag[0].data : null
  return data
}

function tagsContainItem (tags, tagName) {
  return tagsItems(tags, tagName) !== null
}

function orderKeys (unorderedObj) {
  let orderedObj = {}
  Object.keys(unorderedObj).sort().forEach((key) => {
    orderedObj[key] = unorderedObj[key]
  })
  return orderedObj
}

function satToHrp (satoshis) {
  if (!satoshis.toString().match(/^\d+$/)) {
    throw new Error('satoshis must be an integer')
  }
  let millisatoshisBN = new BN(satoshis, 10)
  return millisatToHrp(millisatoshisBN.mul(new BN(1000, 10)))
}

function millisatToHrp (millisatoshis) {
  if (!millisatoshis.toString().match(/^\d+$/)) {
    throw new Error('millisatoshis must be an integer')
  }
  let millisatoshisBN = new BN(millisatoshis, 10)
  let millisatoshisString = millisatoshisBN.toString(10)
  let millisatoshisLength = millisatoshisString.length
  let divisorString, valueString
  if (millisatoshisLength > 11 && /0{11}$/.test(millisatoshisString)) {
    divisorString = ''
    valueString = millisatoshisBN.div(MILLISATS_PER_BTC).toString(10)
  } else if (millisatoshisLength > 8 && /0{8}$/.test(millisatoshisString)) {
    divisorString = 'm'
    valueString = millisatoshisBN.div(MILLISATS_PER_MILLIBTC).toString(10)
  } else if (millisatoshisLength > 5 && /0{5}$/.test(millisatoshisString)) {
    divisorString = 'u'
    valueString = millisatoshisBN.div(MILLISATS_PER_MICROBTC).toString(10)
  } else if (millisatoshisLength > 2 && /0{2}$/.test(millisatoshisString)) {
    divisorString = 'n'
    valueString = millisatoshisBN.div(MILLISATS_PER_NANOBTC).toString(10)
  } else {
    divisorString = 'p'
    valueString = millisatoshisBN.mul(PICOBTC_PER_MILLISATS).toString(10)
  }
  return valueString + divisorString
}

function hrpToSat (hrpString, outputString) {
  let millisatoshisBN = hrpToMillisat(hrpString, false)
  if (!millisatoshisBN.mod(new BN(1000, 10)).eq(new BN(0, 10))) {
    throw new Error('Amount is outside of valid range')
  }
  let result = millisatoshisBN.div(new BN(1000, 10))
  return outputString ? result.toString() : result
}

function hrpToMillisat (hrpString, outputString) {
  let divisor, value
  if (hrpString.slice(-1).match(/^[munp]$/)) {
    divisor = hrpString.slice(-1)
    value = hrpString.slice(0, -1)
  } else if (hrpString.slice(-1).match(/^[^munp0-9]$/)) {
    throw new Error('Not a valid multiplier for the amount')
  } else {
    value = hrpString
  }

  if (!value.match(/^\d+$/)) throw new Error('Not a valid human readable amount')

  let valueBN = new BN(value, 10)

  let millisatoshisBN = divisor
    ? valueBN.mul(MILLISATS_PER_BTC).div(DIVISORS[divisor])
    : valueBN.mul(MILLISATS_PER_BTC)

  if (((divisor === 'p' && !valueBN.mod(new BN(10, 10)).eq(new BN(0, 10))) ||
      millisatoshisBN.gt(MAX_MILLISATS))) {
    throw new Error('Amount is outside of valid range')
  }

  return outputString ? millisatoshisBN.toString() : millisatoshisBN
}

function sign (inputPayReqObj, inputPrivateKey) {
  let payReqObj = cloneDeep(inputPayReqObj)
  let privateKey = hexToBuffer(inputPrivateKey)
  if (payReqObj.complete && payReqObj.paymentRequest) return payReqObj

  let nodePublicKey, tagNodePublicKey
  // If there is a payee_node_key tag convert to buffer
  if (tagsContainItem(payReqObj.tags, TAGNAMES['19'])) {
    tagNodePublicKey = hexToBuffer(tagsItems(payReqObj.tags, TAGNAMES['19']))
  }
  // If there is payeeNodeKey attribute, convert to buffer
  if (payReqObj.payeeNodeKey) {
    nodePublicKey = hexToBuffer(payReqObj.payeeNodeKey)
  }
  // If they are not equal throw an error
  // if (nodePublicKey && tagNodePublicKey && !tagNodePublicKey.equals(nodePublicKey)) {
  //   throw new Error('payee node key tag and payeeNodeKey attribute must match')
  // }

  // make sure if either exist they are in nodePublicKey
  nodePublicKey = tagNodePublicKey || nodePublicKey

  let publicKey = secp256k1.publicKeyCreate(privateKey)

  // Check if pubkey matches for private key
  // if (nodePublicKey && !publicKey.equals(nodePublicKey)) {
  //   throw new Error('The private key given is not the private key of the node public key given')
  // }

  let words = bech32.decode(payReqObj.wordsTemp, Number.MAX_SAFE_INTEGER).words

  // the preimage for the signing data is the buffer of the prefix concatenated
  // with the buffer conversion of the data words excluding the signature
  // (right padded with 0 bits)
  let toSign = Buffer.concat([Buffer.from(payReqObj.prefix, 'utf8'), wordsToBuffer(words)])
  // single SHA256 hash for the signature
  let payReqHash = sha256(toSign)

  // signature is 64 bytes (32 byte r value and 32 byte s value concatenated)
  // PLUS one extra byte appended to the right with the recoveryID in [0,1,2,3]
  // Then convert to 5 bit words with right padding 0 bits.
  let sigObj = secp256k1.sign(payReqHash, privateKey)
  let sigWords = hexToWord(sigObj.signature.toString('hex') + '0' + sigObj.recovery)

  // append signature words to the words, mark as complete, and add the payreq
  payReqObj.payeeNodeKey = publicKey.toString('hex')
  payReqObj.signature = sigObj.signature.toString('hex')
  payReqObj.recoveryFlag = sigObj.recovery
  payReqObj.wordsTemp = bech32.encode('temp', words.concat(sigWords), Number.MAX_SAFE_INTEGER)
  payReqObj.complete = true
  payReqObj.paymentRequest = bech32.encode(payReqObj.prefix, words.concat(sigWords), Number.MAX_SAFE_INTEGER)

  return orderKeys(payReqObj)
}

/* MUST but default OK:
  coinType  (default: testnet OK)
  timestamp   (default: current time OK)

  MUST:
  signature OR privatekey
  tags[TAGNAMES['1']] (payment hash)
  tags[TAGNAMES['13']] OR tags[TAGNAMES['23']] (description or description for hashing (or description hash))

  MUST CHECK:
  IF tags[TAGNAMES['19']] (payee_node_key) THEN MUST CHECK THAT PUBKEY = PUBKEY OF PRIVATEKEY / SIGNATURE
  IF tags[TAGNAMES['9']] (fallback_address) THEN MUST CHECK THAT THE ADDRESS IS A VALID TYPE
  IF tags[TAGNAMES['3']] (routing_info) THEN MUST CHECK FOR ALL INFO IN EACH
*/
function encode (inputData, addDefaults) {
  // we don't want to affect the data being passed in, so we copy the object
  let data = cloneDeep(inputData)

  // by default we will add default values to description, expire time, and min cltv
  if (addDefaults === undefined) addDefaults = true

  let canReconstruct = !(data.signature === undefined || data.recoveryFlag === undefined)

  // use current time as default timestamp (seconds)
  if (data.timestamp === undefined && !canReconstruct) {
    data.timestamp = Math.floor(new Date().getTime() / 1000)
  } else if (data.timestamp === undefined && canReconstruct) {
    throw new Error('Need timestamp for proper payment request reconstruction')
  }

  let nodePublicKey, tagNodePublicKey
  // If there is a payee_node_key tag convert to buffer
  if (tagsContainItem(data.tags, TAGNAMES['19'])) tagNodePublicKey = hexToBuffer(tagsItems(data.tags, TAGNAMES['19']))
  // If there is payeeNodeKey attribute, convert to buffer
  if (data.payeeNodeKey) nodePublicKey = hexToBuffer(data.payeeNodeKey)
  if (nodePublicKey && tagNodePublicKey && !tagNodePublicKey.equals(nodePublicKey)) {
    throw new Error('payeeNodeKey and tag payee node key do not match')
  }
  // in case we have one or the other, make sure it's in nodePublicKey
  nodePublicKey = nodePublicKey || tagNodePublicKey
  if (nodePublicKey) data.payeeNodeKey = nodePublicKey.toString('hex')

  let code, addressHash, address

  let prefix = 'insta'

  let hrpString
  // calculate the smallest possible integer (removing zeroes) and add the best
  // divisor (m = milli, u = micro, n = nano, p = pico)
  if (data.millisatoshis && data.satoshis) {
    hrpString = millisatToHrp(new BN(data.millisatoshis, 10))
    let hrpStringSat = satToHrp(new BN(data.satoshis, 10))
    if (hrpStringSat !== hrpString) {
      throw new Error('satoshis and millisatoshis do not match')
    }
  } else if (data.millisatoshis) {
    hrpString = millisatToHrp(new BN(data.millisatoshis, 10))
  } else if (data.satoshis) {
    hrpString = satToHrp(new BN(data.satoshis, 10))
  } else {
    hrpString = ''
  }

  // bech32 human readable part is insta bc2500m (insta + coinbech32 + satoshis (optional))
  // instabc or instatb would be valid as well. (no value specified)
  prefix += hrpString

  // timestamp converted to 5 bit number array (left padded with 0 bits, NOT right padded)
  let timestampWords = intBEToWords(data.timestamp)

  let tags = data.tags
  let tagWords = []
  tags.forEach(tag => {
    const possibleTagNames = Object.keys(TAGENCODERS)
    if (canReconstruct) possibleTagNames.push(unknownTagName)
    // check if the tagName exists in the encoders object, if not throw Error.
    if (possibleTagNames.indexOf(tag.tagName) === -1) {
      throw new Error('Unknown tag key: ' + tag.tagName)
    }

    let words
    if (tag.tagName !== unknownTagName) {
      // each tag starts with 1 word code for the tag
      tagWords.push(TAGCODES[tag.tagName])

      const encoder = TAGENCODERS[tag.tagName]
      words = encoder(tag.data)
    } else {
      let result = unknownEncoder(tag.data)
      tagWords.push(result.tagCode)
      words = result.words
    }
    // after the tag code, 2 words are used to store the length (in 5 bit words) of the tag data
    // (also left padded, most integers are left padded while buffers are right padded)
    tagWords = tagWords.concat([0].concat(intBEToWords(words.length)).slice(-2))
    // then append the tag data words
    tagWords = tagWords.concat(words)
  })

  // the data part of the bech32 is TIMESTAMP || TAGS || SIGNATURE
  // currently dataWords = TIMESTAMP || TAGS
  let dataWords = timestampWords.concat(tagWords)

  // the preimage for the signing data is the buffer of the prefix concatenated
  // with the buffer conversion of the data words excluding the signature
  // (right padded with 0 bits)
  let toSign = Buffer.concat([Buffer.from(prefix, 'utf8'), Buffer.from(convert(dataWords, 5, 8))])
  // single SHA256 hash for the signature
  let payReqHash = sha256(toSign)

  // signature is 64 bytes (32 byte r value and 32 byte s value concatenated)
  // PLUS one extra byte appended to the right with the recoveryID in [0,1,2,3]
  // Then convert to 5 bit words with right padding 0 bits.
  let sigWords
  if (canReconstruct) {

    if (nodePublicKey) {
      let recoveredPubkey = secp256k1.recover(payReqHash, Buffer.from(data.signature, 'hex'), data.recoveryFlag, true)
      if (nodePublicKey && !nodePublicKey.equals(recoveredPubkey)) {
        throw new Error('Signature, message, and recoveryID did not produce the same pubkey as payeeNodeKey')
      }
      sigWords = hexToWord(data.signature + '0' + data.recoveryFlag)
    } else {
      throw new Error('Reconstruction with signature and recoveryID requires payeeNodeKey to verify correctness of input data.')
    }
  }

  if (sigWords) dataWords = dataWords.concat(sigWords)

  if (tagsContainItem(data.tags, TAGNAMES['6'])) {
    data.timeExpireDate = data.timestamp + tagsItems(data.tags, TAGNAMES['6'])
    data.timeExpireDateString = new Date(data.timeExpireDate * 1000).toISOString()
  }
  data.timestampString = new Date(data.timestamp * 1000).toISOString()
  data.paymentRequest = data.complete ? bech32.encode(prefix, dataWords, Number.MAX_SAFE_INTEGER) : ''
  data.prefix = prefix
  data.wordsTemp = bech32.encode('temp', dataWords, Number.MAX_SAFE_INTEGER)
  data.complete = !!sigWords

  // payment requests get pretty long. Nothing in the spec says anything about length.
  // Even though bech32 loses error correction power over 1023 characters.
  return orderKeys(data)
}

// decode will only have extra comments that aren't covered in encode comments.
// also if anything is hard to read I'll comment.
function decode (paymentRequest) {
  if (typeof paymentRequest !== 'string') throw new Error('Instapay Payment Request must be string')
  if (paymentRequest.slice(0, 5).toLowerCase() !== 'insta') throw new Error('Not a proper instapay payment request')
  let decoded = bech32.decode(paymentRequest, Number.MAX_SAFE_INTEGER)
  paymentRequest = paymentRequest.toLowerCase()
  let prefix = decoded.prefix
  let words = decoded.words

  let coinNetwork = 'insta'
  // signature is always 104 words on the end
  // cutting off at the beginning helps since there's no way to tell
  // ahead of time how many tags there are.
  let sigWords = words.slice(-104)
  // grabbing a copy of the words for later, words will be sliced as we parse.
  let wordsNoSig = words.slice(0, -104)
  words = words.slice(0, -104)

  let sigBuffer = wordsToBuffer(sigWords, true)
  let recoveryFlag = sigBuffer.slice(-1)[0]
  sigBuffer = sigBuffer.slice(0, -1)

  if (!(recoveryFlag in [0, 1, 2, 3]) || sigBuffer.length !== 64) {
    throw new Error('Signature is missing or incorrect')
  }

  // Without reverse lookups, can't say that the multipier at the end must
  // have a number before it, so instead we parse, and if the second group
  // doesn't have anything, there's a good chance the last letter of the
  // coin type got captured by the third group, so just re-regex without
  // the number.
  let prefixMatches = prefix.match(/^insta(\d*)([a-zA-Z]?)$/)

  if (prefixMatches && !prefixMatches[2]) prefixMatches = prefix.match(/^insta(\S+)$/)
  if (!prefixMatches) {
    throw new Error('Not a proper Instapay payment request')
  }
  let value = prefixMatches[1]

  let satoshis, millisatoshis, removeSatoshis
  if (value) {
    let divisor = prefixMatches[2]
    try {
      satoshis = parseInt(hrpToSat(value + divisor, true))
    } catch (e) {
      satoshis = null
      removeSatoshis = true
    }
    millisatoshis = hrpToMillisat(value + divisor, true)
  } else {
    satoshis = null
    millisatoshis = null
  }

  // reminder: left padded 0 bits
  let timestamp = wordsToIntBE(words.slice(0, 7))
  let timestampString = new Date(timestamp * 1000).toISOString()
  words = words.slice(7) // trim off the left 7 words

  let tags = []
  let tagName, parser, tagLength, tagWords
  // we have no tag count to go on, so just keep hacking off words
  // until we have none.
  while (words.length > 0) {
    let tagCode = words[0].toString()
    tagName = TAGNAMES[tagCode] || unknownTagName
    parser = TAGPARSERS[tagCode] || getUnknownParser(tagCode)
    words = words.slice(1)

    tagLength = wordsToIntBE(words.slice(0, 2))
    words = words.slice(2)

    tagWords = words.slice(0, tagLength)
    words = words.slice(tagLength)

    tags.push({
      tagName,
      data: parser(tagWords, coinNetwork)
    })
  }

  let timeExpireDate, timeExpireDateString
  // be kind and provide an absolute expiration date.
  // good for logs
  if (tagsContainItem(tags, TAGNAMES['6'])) {
    timeExpireDate = timestamp + tagsItems(tags, TAGNAMES['6'])
    timeExpireDateString = new Date(timeExpireDate * 1000).toISOString()
  }

  let toSign = Buffer.concat([Buffer.from(prefix, 'utf8'), Buffer.from(convert(wordsNoSig, 5, 8))])
  let payReqHash = sha256(toSign)
  let sigPubkey = secp256k1.recover(payReqHash, sigBuffer, recoveryFlag, true)

  let finalResult = {
    paymentRequest,
    complete: true,
    prefix,
    wordsTemp: bech32.encode('temp', wordsNoSig.concat(sigWords), Number.MAX_SAFE_INTEGER),
    satoshis,
    millisatoshis,
    timestamp,
    timestampString,
    payeeNodeKey: tags[0].data,
    signature: sigBuffer.toString('hex'),
    recoveryFlag,
    tags
  }

  // if (removeSatoshis) {
  //   delete finalResult['satoshis']
  // }

  if (timeExpireDate) {
    finalResult = Object.assign(finalResult, {timeExpireDate, timeExpireDateString})
  }

  return orderKeys(finalResult)
}

module.exports = {
  encode,
  decode,
  sign,
  satToHrp,
  millisatToHrp,
  hrpToSat,
  hrpToMillisat
}