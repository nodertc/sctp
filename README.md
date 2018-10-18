# @nodertc/sctp

[![stability-experimental](https://img.shields.io/badge/stability-experimental-orange.svg)](https://github.com/emersion/stability-badges#experimental)
[![Build Status](https://travis-ci.org/nodertc/sctp.svg?branch=master)](https://travis-ci.org/nodertc/sctp)
[![npm](https://img.shields.io/npm/v/@nodertc/sctp.svg)](https://npmjs.org/package/@nodertc/sctp)
[![node](https://img.shields.io/node/v/@nodertc/sctp.svg)](https://npmjs.org/package/@nodertc/sctp)
[![license](https://img.shields.io/npm/l/@nodertc/sctp.svg)](https://npmjs.org/package/@nodertc/sctp)
[![downloads](https://img.shields.io/npm/dm/@nodertc/sctp.svg)](https://npmjs.org/package/@nodertc/sctp)

SCTP network protocol [RFC4960](https://tools.ietf.org/html/rfc4960) in plain js

## Install

```bash
npm i @nodertc/sctp
```

## Usage
You need to provide 'udpTransport' option
when connecting socket or creating server:

```
const socket = sctp.connect({
  passive: true,
  localPort: 5000,
  port: 5000,
  udpTransport: udpSocket,
});

server.on('connection', socket => {
  console.log('socket connected')
  socket.write(Buffer.from('010003010000001000110008000003ea', 'hex'))
})

socket.on('data', buffer => {
  console.log('socket received data from server', buffer)
  socket.end()
})
```

In UDP mode host and localAddress will be ignored,
because addressing is provided by underlying transport.

Also note that in most cases "passive" connect is a better alternative to creating server.

**passive** option disables active connect to remote peer.
Socket waits for remote connection,
allowing it only from indicated remote port.
This unusual option doesn't exist in TCP API.

### new net.Socket([options])
* options [Object]

For SCTP socketss, available options are:

* ppid [number] Payload protocol id (see below)
* stream_id [number] SCTP stream id. Default: 0
* unordered [boolean] Indicate unordered mode. Default: false
* no_bundle [boolean] Disable chunk bundling. Default: false

Note: SCTP does not support a half-open state (like TCP)
wherein one side may continue sending data while the other end is closed.

### socket.connect(options[, connectListener])
* options [Object]
* connectListener [Function] Common parameter of socket.connect() methods.
Will be added as a listener for the 'connect' event once.

For SCTP connections, available options are:

* port [number] Required. Port the socket should connect to.
* host [string] Host the socket should connect to. Default: 'localhost'
* localAddress [string] Local address the socket should connect from.
* localPort [number] Local port the socket should connect from.
* MIS [number] Maximum inbound streams. Default: 2
* OS [number] Requested outbound streams. Default: 2
* passive [boolean] Indicates passive mode. Socket will not connect,
but allow connection of remote socket from host:port. Default: false
* udpTransport [Object] UDP transport socket

### socket.createStream(id)
Creates SCTP stream with stream id. Those are SCTP socket sub-streams.

> After the association is initialized, the valid outbound stream
  identifier range for either endpoint shall be 0 to min(local OS, remote MIS)-1.

You can check this negotiated value by referring to `socket.OS`
after 'connect' event. id should be less the socket.OS.

Result is stream.Writable.

```
const stream = socket.createStream(1)
stream.write('some data')
```

### Socket events
See [Net] module documentation.

For SCTP additional event 'stream' is defined.
It signals that incoming data chunk were noticed with new SCTP stream id.

```
socket.on('stream', (stream, id) => {
  stream.on('data', data => {
    // Incoming data
  })
})
```

### sctp.defaults(options)
Function sets default module parameters. Names follow net.sctp conventions. Returns current default parameters.

See `sysctl -a | grep sctp`

Example:

```
sctp.defaults({
  rto_initial: 500,
  rto_min: 300,
  rto_max: 1000,
  sack_timeout: 150,
  sack_freq: 2,
})
```

### sctp.PPID
sctp.PPID is an object with [SCTP Payload Protocol Identifiers][ppid]

```
{
  SCTP: 0,
  IUA: 1,
  M2UA: 2,
  M3UA: 3,
  SUA: 4,
  M2PA: 5,
  V5UA: 6,
  H248: 7,
  BICC: 8,
  ...
  }
```

## RFC to implement
* [3758 Partial Reliability Extension][RFC3758]
* [4820 Padding Chunk and Parameter][RFC4820]
* [4895 Authenticated Chunks][RFC4895]
* [5061 Dynamic Address Reconfiguration][RFC5061]
* [5062 Security Attacks Found Against SCTP and Current Countermeasures][RFC5062]
* [6525 Stream Reconfiguration][RFC6525]
* [7053 SACK-IMMEDIATELY Extension (I-bit)][RFC7053]
* [7496 Additional Policies for the Partially Reliable Extension][RFC7496]
* [7829 SCTP-PF: A Quick Failover Algorithm][RFC7829]
* [8260 Stream Schedulers and User Message Interleaving (I-DATA Chunk)][RFC8260]
* [Draft: ECN for Stream Control Transmission Protocol][ECN]

## License

- MIT, 2017-2018 &copy; Vladimir Latyshev
- MIT, 2018 &copy; Dmitriy Tsvettsikh

[raw-socket]: https://www.npmjs.com/package/raw-socket
[Net]: https://nodejs.org/api/net.html
[UDP]: https://nodejs.org/api/dgram.html
[RTCDataChannel]: https://developer.mozilla.org/en-US/docs/Web/API/RTCDataChannel
[RFC4960]: https://tools.ietf.org/html/rfc4960
[RFC6458]: https://tools.ietf.org/html/rfc6458
[RFC8261]: https://tools.ietf.org/html/rfc8261
[smpp]: https://www.npmjs.com/package/smpp
[ppid]: https://www.iana.org/assignments/sctp-parameters/sctp-parameters.xhtml#sctp-parameters-25
[RFC3758]: https://tools.ietf.org/html/rfc3758
[RFC4820]: https://tools.ietf.org/html/rfc4820
[RFC4895]: https://tools.ietf.org/html/rfc4895
[RFC5061]: https://tools.ietf.org/html/rfc5061
[RFC5062]: https://tools.ietf.org/html/rfc5062
[RFC6525]: https://tools.ietf.org/html/rfc6525
[RFC7053]: https://tools.ietf.org/html/rfc7053
[RFC7496]: https://tools.ietf.org/html/rfc7496
[RFC7829]: https://tools.ietf.org/html/rfc7829
[RFC8260]: https://tools.ietf.org/html/rfc8260
[ECN]: https://tools.ietf.org/html/draft-stewart-tsvwg-sctpecn-05
[sctptests]: https://github.com/nplab/sctp-tests
