const debug = require('debug')
const ip = require('ip')
const Packet = require('./packet')

const IP_TTL = 64
// https://www.iana.org/assignments/protocol-numbers/protocol-numbers.xhtml
const SCTP_PROTO = 132
const SO_RCVBUF = 1024 * 256
const SO_SNDBUF = SO_RCVBUF
const BUFFER_SIZE = 1024 * 4

const IP_HEADER_TEMPLATE = Buffer.from([
  0x45, // Version and header length
  0x00, // Dfs
  0x00, // Packet length
  0x00,
  0x00, // Id
  0x00,
  0x00, // Flags
  0x00, // Offset
  IP_TTL,
  SCTP_PROTO,
  0x00, // Checksum
  0x00,
  0x00, // Source address
  0x00,
  0x00,
  0x00,
  0x00, // Destination address
  0x00,
  0x00,
  0x00
])

let raw = null
let rawtransport = null

const checkLength =
  process.platform === 'darwin' ?
    (buffer, headerLen, packetLen) => buffer.length === headerLen + packetLen :
    (buffer, headerLen, packetLen) => buffer.length === packetLen

const readLength =
  process.platform === 'darwin' ?
    buffer => buffer.readUInt16LE(2) :
    buffer => buffer.readUInt16BE(2)

const writeLength =
  process.platform === 'darwin' ?
    (buffer, value) => buffer.writeUInt16LE(value, 2) :
    (buffer, value) => buffer.writeUInt16BE(value, 2)

const transports = new WeakMap()

class Transport {
  constructor() {
    this.pool_start = 0xC000
    this.pool_finish = 0xFFFF
    this.pool_size = this.pool_finish - this.pool_start
    this.pool = {}
    this.pointer = this.pool_start
    this.countRcv = 0
  }

  register(endpoint) {
    endpoint.localPort = this.allocate(endpoint.localPort)
    if (endpoint.localPort) {
      this.pool[endpoint.localPort] = endpoint
      this.debug('endpoint registered on port %d', endpoint.localPort)
      return endpoint
    }
  }

  allocate(desired) {
    if (desired > 0 && desired < 0xFFFF) {
      if (desired in this.pool) {
        return null
      }
      return desired
    }
    let attempt = 0
    while (this.pointer in this.pool) {
      this.debug('attempt #%d to allocate port %d', attempt, this.pointer)
      attempt++
      if (attempt > this.pool_size) {
        return null
      }
      this.pointer++
      if (this.pointer > this.pool_finish) {
        this.pointer = this.pool_start
      }
    }
    return this.pointer
  }

  unallocate(port) {
    delete this.pool[port]
    this.debug('unallocate port %d', port)
  }

  receivePacket(packet, src, dst) {
    if (packet && packet.chunks) {
      this.debug(
        '< packet %d chunks %s:%d <- %s:%d',
        packet.chunks.length,
        dst,
        packet.dst_port,
        src,
        packet.src_port
      )
      const endpoint = this.pool[packet.dst_port]
      if (endpoint) {
        endpoint.emit('packet', packet, src, dst)
      } else {
        this.debug('OOTB message', packet)
      }
    } else {
      this.debug('SCTP packet decode error')
    }
  }
}

class RawTransport extends Transport {
  constructor(options) {
    super()

    options = options || {}

    this.debug = debug('sctp:transport:raw')

    this.debug('opening raw socket %o', options)

    if (!raw) {
      raw = require('raw-socket')
    }

    const rawsocket = raw.createSocket({
      addressFamily: raw.AddressFamily.IPv4,
      protocol: SCTP_PROTO,
      bufferSize: BUFFER_SIZE
    })

    rawsocket.setOption(
      raw.SocketLevel.IPPROTO_IP,
      raw.SocketOption.IP_TTL,
      IP_TTL
    )
    rawsocket.setOption(
      raw.SocketLevel.SOL_SOCKET,
      raw.SocketOption.SO_RCVBUF,
      SO_RCVBUF
    )
    rawsocket.setOption(
      raw.SocketLevel.SOL_SOCKET,
      raw.SocketOption.SO_SNDBUF,
      SO_SNDBUF
    )

    // Workaround to start listening on win32 // todo
    if (process.platform === 'win32') {
      rawsocket.send(Buffer.alloc(20), 0, 0, '127.0.0.1', null, () => {})
    }
    this.debug('raw socket opened on %s', process.platform)

    if (options.icmp) {
      setTimeout(this.enableICMP.bind(this), 0)
    }

    rawsocket.on('message', (buffer, src) => {
      this.countRcv++
      this.debug('< message %d bytes from %s', buffer.length, src)
      if (buffer.length < 36) {
        return
      } // Less than ip header + sctp header

      const headerLength = (buffer[0] & 0x0F) << 2
      // Const protocol = buffer[9]
      const dst = ip.toString(buffer, 16, 4)
      const packetLength = readLength(buffer)
      if (!checkLength(buffer, headerLength, packetLength)) {
        return
      }
      this.debug('< ip packet ok %s <- %s', dst, src)
      const payload = buffer.slice(headerLength)

      const packet = Packet.fromBuffer(payload)
      this.receivePacket(packet, src, dst)
    })

    this.rawsocket = rawsocket
  }

  sendPacket(src, dst, packet, callback) {
    const payload = packet.toBuffer()
    this.debug(
      '> send %d bytes %d chunks %s:%d -> %s:%d',
      payload.length,
      packet.chunks.length,
      src,
      packet.src_port,
      dst,
      packet.dst_port
    )
    let buffer
    const cb = (error, bytes) => {
      if (error) {
        this.debug('raw socket send error', error)
      } else {
        this.debug('raw socket sent %d bytes', bytes)
      }
      if (typeof callback === 'function') {
        callback(error)
      }
    }

    let beforeSend
    if (src) {
      beforeSend = () =>
        this.rawsocket.setOption(
          raw.SocketLevel.IPPROTO_IP,
          raw.SocketOption.IP_HDRINCL,
          1
        )
      const headerBuffer = createHeader({src, dst, payload})
      this.debug('headerBuffer', headerBuffer)
      const checksum = raw.createChecksum(headerBuffer)
      raw.writeChecksum(headerBuffer, 10, checksum)
      buffer = Buffer.concat([headerBuffer, payload])
    } else {
      beforeSend = () =>
        this.rawsocket.setOption(
          raw.SocketLevel.IPPROTO_IP,
          raw.SocketOption.IP_HDRINCL,
          0
        )
      buffer = payload
    }
    this.rawsocket.send(buffer, 0, buffer.length, dst, beforeSend, cb)
    return true
  }

  enableICMP() {
    this.debug('start ICMP RAW socket on %s', process.platform)

    this.icmpsocket = raw.createSocket({
      addressFamily: raw.AddressFamily.IPv4,
      protocol: raw.Protocol.ICMP
    })
    this.icmpsocket.setOption(
      raw.SocketLevel.IPPROTO_IP,
      raw.SocketOption.IP_TTL,
      IP_TTL
    )

    if (process.platform === 'win32') {
      const buffer = Buffer.alloc(24)
      this.icmpsocket.send(
        buffer,
        0,
        buffer.length,
        '127.0.0.1',
        null,
        (error, bytes) => {
          this.debug('> ICMP ping', error, bytes)
        }
      )
    }

    this.debug('ICMP socket opened on %s', process.platform)

    this.icmpsocket.on('message', (buffer, src) => {
      if (src === '127.0.0.1') {
        return
      }
      this.debug('< ICMP from %s', src, buffer.length, buffer)
      if (buffer.length < 42) {
        // IP header + ICMP header + 8 = 20 + 16 + 8 = 42
        return
      }
      const headerLength = (buffer[0] & 0x0F) << 2
      const packetLength = readLength(buffer)
      if (!checkLength(buffer, headerLength, packetLength)) {
        return
      }
      const payload = buffer.slice(headerLength)
      this.processICMPPacket(payload)
    })
  }

  processICMPPacket(buffer) {
    /*

     https://tools.ietf.org/html/rfc792

      0                   1                   2                   3
      0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1
     +-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
     |     Type      |     Code      |          Checksum             |
     +-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
     |                             unused                            |
     +-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
     |      Internet Header + 64 bits of Original Data Datagram      |
     +-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+

    */

    const type = buffer[0]
    if (type !== 3) {
      // An implementation MAY ignore all ICMPv4 messages
      // where the type field is not set to "Destination Unreachable"
      return
    }

    const code = buffer[1]
    /*
     An implementation MAY ignore any ICMPv4 messages where the code
     does not indicate "Protocol Unreachable" or "Fragmentation Needed".

     Code
        0 = net unreachable;
        1 = host unreachable;
        2 = protocol unreachable;
        3 = port unreachable;
        4 = fragmentation needed and DF set;
        5 = source route failed.
    */
    if (code !== 2 && code !== 4) {
      return
    }
    const payload = buffer.slice(8)

    this.processICMPPayload(payload, code)
  }

  processICMPPayload(buffer, code) {
    this.debug('< ICMP code %d', code, buffer.length, buffer)

    const headerLength = (buffer[0] & 0x0F) << 2
    const protocol = buffer[9]
    if (protocol !== SCTP_PROTO) {
      return
    }
    const dst = ip.toString(buffer, 16, 4)
    const src = ip.toString(buffer, 12, 4)

    const sctpBuffer = buffer.slice(headerLength)
    this.debug('< ICMP code %d', code, src, dst, sctpBuffer)

    const packet = Packet.fromBuffer(sctpBuffer)

    if (packet) {
      const endpoint = this.pool[packet.src_port]
      if (endpoint) {
        endpoint.emit('icmp', packet, src, dst, code)
      } else {
        // If the association cannot be found,
        // an implementation SHOULD ignore the ICMP message.
      }
    }
  }
}

class UDPTransport extends Transport {
  constructor(udpTransport) {
    super()

    this.debug = debug('sctp:transport:udp')
    this.socket = udpTransport

    this.socket.on('close', () => {
      this.debug('error: transport was closed')
      for (const port in this.pool) {
        const endpoint = this.pool[port]
        endpoint.close()
      }
      delete this.socket
      delete transports[this.socket]
    })

    this.socket.on('message', buffer => {
      this.countRcv++
      this.debug('< message %d bytes', buffer.length)
      if (buffer.length < 20) {
        return
      } // Less than sctp header
      const packet = Packet.fromBuffer(buffer)
      this.receivePacket(packet)
    })
  }

  sendPacket(src, dst, packet, callback) {
    const payload = packet.toBuffer()
    this.debug(
      '> send %d bytes %d chunks %d -> %d',
      payload.length,
      packet.chunks.length,
      packet.src_port,
      packet.dst_port
    )
    const buffer = payload
    this.socket.send(buffer, 0, buffer.length, callback)
    return true
  }
}

function createHeader(packet) {
  const buffer = Buffer.from(IP_HEADER_TEMPLATE)
  writeLength(buffer, buffer.length + packet.payload.length)
  if (packet.ttl > 0 && packet.ttl < 0xFF) {
    buffer.writeUInt8(packet.ttl, 8)
  }
  ip.toBuffer(packet.src, buffer, 12)
  ip.toBuffer(packet.dst, buffer, 16)
  return buffer
}

function register(endpoint) {
  if (endpoint.udpTransport) {
    if (transports.has(endpoint.udpTransport)) {
      endpoint.transport = transports.get(endpoint.udpTransport)
    } else {
      endpoint.transport = new UDPTransport(endpoint.udpTransport)
      transports.set(endpoint.udpTransport, endpoint.transport)
    }
  } else {
    if (!rawtransport) {
      rawtransport = new RawTransport({icmp: true})
    }
    endpoint.transport = rawtransport
  }
  return endpoint.transport.register(endpoint)
}

module.exports = {
  register
}