const net = require('net');
const EventEmitter = require('events');
const debug = false;

class MQTTServer extends EventEmitter
{
	#port    = 1883;
	#topics  = {};
	#clients = new Set();
	#server  = null;

	get Topics () { return this.#topics; }

	constructor() 
	{
		super();
	}
  
	Listen(port = 1883) 
	{
		this.#port = port;
		this.#server = net.createServer((socket) => this.handleConnection(socket));
		this.#server.listen(this.#port, () => 
		{
			if (debug) console.log(`MQTT server listening on port ${this.#port}`);
		});

		this.#server.on('error', (error) => 
		{
			if (debug) console.error('Server error:', error);
		});
	}
  
	handleConnection(socket) 
	{
		const clientIP = socket.remoteAddress;
		const clientPort = socket.remotePort;
		if (debug) console.log(`Client connected from ${clientIP}:${clientPort}`);
		this.#clients.add(socket);
	
		socket.on('data', (data) => 
		{
			try {
				const messages = this.parseMessages(data);
				messages.forEach(message => this.handleMessage(socket, message));
			} 
			catch (error) 
			{
				if (debug) console.error(`Error processing message from ${clientIP}:${clientPort}:`, error);
				socket.write(Buffer.from([0x20, 0x02, 0x00, 0x80])); // CONNACK with error
			}
		});
	
		socket.on('end', () => 
		{
			if (debug) console.log(`Client disconnected from ${clientIP}:${clientPort}`);
			this.handleDisconnect(socket);
	  	});

	  	socket.on('error', (error) => 
		{
			console.error(`Socket error from ${clientIP}:${clientPort}:`, error);
			this.handleDisconnect(socket);
	  	});
	}

	parseMessages(data) 
	{
	const messages = [];
	let offset = 0;

	//if (debug) console.log('Raw data:', data);

	while (offset < data.length) 
	{
		const firstByte = data[offset];
		const messageType  = firstByte >> 4;
		const controlFlags = firstByte & 0x0F;
		const controlFlags_DUP = (controlFlags & 0x08) >> 3;
		const controlFlags_QoS = (controlFlags & 0x06) >> 1;
		const controlFlags_RETAIN = controlFlags & 0x01;
		
		// Parse remaining length
		let remainingLength = 0;
		let multiplier = 1;
		let bytesRead = 1;
		while (true) 
		{
		if (offset + bytesRead >= data.length)
			throw new Error('Malformed remaining length');
		
		const byte = data[offset + bytesRead];
		remainingLength += (byte & 127) * multiplier;
		if (multiplier > 128 * 128 * 128)
			throw new Error('Malformed remaining length');
		bytesRead++;
		if ((byte & 128) === 0)
			break;

		multiplier *= 128;
		}

		const packetEnd = offset + bytesRead + remainingLength;
		if (packetEnd > data.length) 
			throw new Error('Incomplete MQTT packet');

		const packet = data.slice(offset + bytesRead, packetEnd);
		messages.push({type: messageType, flags: {DUP: controlFlags_DUP, QoS: controlFlags_QoS, RETAIN: controlFlags_RETAIN}, packet: packet});

		offset = packetEnd;
	}

	return messages;
	}

	handleMessage(socket, message) 
	{
		const clientIP = socket.remoteAddress;
		const clientPort = socket.remotePort;

		switch (message.type) 
		{
			case 1: // CONNECT
				if (debug) console.log(`\nHandling CONNECT from ${clientIP}:${clientPort}`);
				this.handleConnect(socket, message);      
				break;
			case 3: // PUBLISH
				if (debug) console.log(`\nHandling PUBLISH from ${clientIP}:${clientPort}`);
				this.handlePublish(socket, message);
				break;
			case 8: // SUBSCRIBE
				if (debug) console.log(`\nHandling SUBSCRIBE from ${clientIP}:${clientPort}`);
				this.handleSubscribe(socket, message.packet);
				break;
			case 10: // UNSUBSCRIBE
				if (debug) console.log(`\nHandling SUBSCRIBE from ${clientIP}:${clientPort}`);
				this.handleUnsubscribe(socket, message.packet);
				break;	  
			case 12: // PINGREQ
				if (debug) console.log(`\nHandling PINGREQ from ${clientIP}:${clientPort}`);
				this.handlePingReq(socket);
				break;
			case 14: // DISCONNECT
				if (debug) console.log(`\nHandling DISCONNECT from ${clientIP}:${clientPort}`);
				this.handleDisconnect(socket);
				break;
			default:
				if (debug) console.log(`Unsupported message type: ${message.type} from ${clientIP}:${clientPort}`);
		}
	}

	handleConnect(socket, message)
	{		
		const clientIP = socket.remoteAddress;
		const clientPort = socket.remotePort;
		const packet = message.packet;
	
		if (debug) console.log('\n    Recv CONNECT packet:', packet);
		try
		{
			let offset=0;
			const protocolNameLength = packet.readUInt16BE(offset);
			offset += 2;
			const protocolName = packet.slice(offset, offset + protocolNameLength).toString();
			offset += protocolNameLength;
			if (debug) console.log('        Protocol name:', protocolName);
			
			const protocolVersion = packet[offset];
			offset++;
			if (debug) console.log('        Protocol version:', protocolVersion);

			const connectFlags = packet[offset];
			offset++;	
			if (debug) console.log('        Connect flags:', connectFlags);

			const keepAlive = packet.readUInt16BE(offset);
			offset += 2;
			if (debug) console.log('        Keep alive:', keepAlive);

			const clientIdLength = packet.readUInt16BE(offset);
			offset += 2;
			const clientId = packet.slice(offset, offset + clientIdLength).toString();
			offset += clientIdLength;
			if (debug) console.log('        Client ID:', clientId);

			if (connectFlags & 0x04)
			{
				const willTopicLength = packet.readUInt16BE(offset);
				offset += 2;
				const willTopic = packet.slice(offset, offset + willTopicLength).toString();
				offset += willTopicLength;
				if (debug) console.log('        Will topic:', willTopic);

				const willMessageLength = packet.readUInt16BE(offset);
				offset += 2;
				const willMessage = packet.slice(offset, offset + willMessageLength).toString();
				offset += willMessageLength;
				if (debug) console.log('        Will message:', willMessage);
			}

			if (connectFlags & 0x80)
			{
				const usernameLength = packet.readUInt16BE(offset);
				offset += 2;
				const username = packet.slice(offset, offset + usernameLength).toString();
				offset += usernameLength;
				if (debug) console.log('        Username:', username);
			}

			if (connectFlags & 0x40)
			{
				const passwordLength = packet.readUInt16BE(offset);
				offset += 2;
				const password = packet.slice(offset, offset + passwordLength).toString();
				offset += passwordLength;
				if (debug) console.log('        Password:', password);
			}

			//Broadcast
			socket.clientId = clientId;
			this.emit('connect', socket);
			this.emit(`connect_${clientId}`, socket);

			//Responsd with okay
			const connack = Buffer.from([0x20, 0x02, 0x00, 0x00]); // CONNACK with no error
			socket.write(connack);
			
			if (debug) console.log(`\n    CONNACK`, connack);
			if (debug) console.log(`        Sent to ${clientIP}:${clientPort}`);

		}
		catch (error)
		{
			console.error(`Error handling CONNECT from ${clientIP}:${clientPort}:`, error);
			socket.write(Buffer.from([0x20, 0x02, 0x00, 0x03])); // CONNACK server unavailable
		}
	}

	handlePublish(socket, message) 
	{
		const clientIP = socket.remoteAddress;
		const clientPort = socket.remotePort;
		const packet = message.packet;

		//HANDLE A PUBLISH
		if (debug) console.log('\n    Recv PUBLISH packet:', packet, message.flags);
		try 
		{
			let offset = 0;  // Start at the 5th byte

			const topicLength = packet.readUInt16BE(offset);
			offset += 2;	
			const topic = packet.slice(offset, offset + topicLength).toString();
			offset += topicLength;
			if (debug) console.log('        Topic:', topic);

			// Check if packet has packet identifier (for QoS > 0)
			var packetId = 0;
			if (message.flags.QoS > 0)
			{
				packetId = packet.readUInt16BE(offset);
				offset += 2; // Skip packet identifier
				if (debug) console.log('        Packet ID:', packetId);
			}

			const content = packet.slice(offset);
			if (debug) console.log('        Content:', content.toString('utf8'));    
			//if (debug) console.log(`    Publishing to topic: ${topic} from ${clientIP}:${clientPort}`);

			if (!this.#topics[topic]) 
				this.#topics[topic] = new Set();

			this.publishToSubscribers(socket, topic, content);

			// Send PUBACK for QoS level 1
			if (message.flags.QoS === 1)
			{
				const puback = Buffer.from([0x40, 0x02, packetId >> 8, packetId & 0xFF]);
				socket.write(puback);
				if (debug) console.log('\n    SEND PUBACK:', puback);
				if (debug) console.log(`        Sent PUBACK to ${clientIP}:${clientPort}`);
			}
		} catch (error) 
		{
			console.error(`Error handling PUBLISH from ${clientIP}:${clientPort}:`, error);
		}
	}

	handleSubscribe(socket, packet) 
	{
		const clientIP = socket.remoteAddress;
		const clientPort = socket.remotePort;
	
		if (debug) console.log('\n    Recv SUBSCRIBE packet:', packet);
	
		try 
		{
			let offset = 0;  // Start at the 5th byte
			let packetId = packet.readUInt16BE(offset);  // Packet Identifier
			offset += 2;
			let subscriptions = [];
		
			while (offset < packet.length) 
			{
				const topicLength = packet.readUInt16BE(offset);
				offset += 2;
		
				if (offset + topicLength > packet.length)
				throw new Error('Topic length exceeds packet bounds in SUBSCRIBE packet');
		
				const topic = packet.slice(offset, offset + topicLength).toString();
				offset += topicLength;
				if (debug) console.log('        Topic:', topic);
		
				if (offset >= packet.length)
					throw new Error('Missing QoS byte in SUBSCRIBE packet');
		
				const qos = packet[offset] & 0x03;  // Ensure QoS is 0, 1, or 2
				offset += 1;
		
				//if (debug) console.log(`Subscribing to topic: "${topic}" with QoS: ${qos} from ${clientIP}:${clientPort}`);
		
				if (!this.#topics[topic])
				{
					this.#topics[topic] = new Set();
					if (debug) console.log('        Created new topic:', topic);
				}
				
				this.#topics[topic].add(socket);
				if (debug) console.log(`        Added subscriber ${clientIP}:${clientPort} to topic:`, topic);
				subscriptions.push({ topic, qos });
			}
		
			// Prepare SUBACK
			const suback = Buffer.alloc(4 + subscriptions.length);
			suback[0] = 0x90;  // SUBACK packet type
			suback[1] = 2 + subscriptions.length;  // Remaining length
			suback.writeUInt16BE(packetId, 2);  // Packet Identifier
		
			// Write return codes
			for (let i = 0; i < subscriptions.length; i++) 
			{
				suback[i + 4] = subscriptions[i].qos;  // Granted QoS level
			}
		
			if (debug) console.log('\n    Send SUBACK:', suback);
			socket.write(suback);
			if (debug) console.log(`        Sent SUBACK to ${clientIP}:${clientPort}`);
		} 
		catch (error) 
		{
			console.error(`Error handling SUBSCRIBE from ${clientIP}:${clientPort}:`, error);
			// In case of error, send a failure SUBACK
			const suback = Buffer.from([0x90, 0x03, 0x00, 0x00, 0x80]);
			socket.write(suback);
		}
	}

	handleUnsubscribe(socket, packet) 
	{
		const clientIP = socket.remoteAddress;
		const clientPort = socket.remotePort;

		if (debug) console.log('Raw UNSUBSCRIBE packet:', packet);

		try 
		{
			let offset = 0;  // Start at the 5th byte
			packetId = packet.readUInt16BE(offset);  // Packet Identifier
			offset += 2;
			let subscriptions = [];

			while (offset < packet.length) 
			{
				const topicLength = packet.readUInt16BE(offset);
				offset += 2;
				if (debug) console.log('Topic length:', topicLength);

				if (offset + topicLength > packet.length) {
					throw new Error('Topic length exceeds packet bounds in SUBSCRIBE packet');
				}

				const topic = packet.slice(offset, offset + topicLength).toString();
				offset += topicLength;
				if (debug) console.log('Topic:', topic);
				if (debug) console.log(`Unsubscribing from topic: "${topic}" from ${clientIP}:${clientPort}`);
				if (this.#topics[topic]) 
				{
					this.#topics[topic].delete(socket);
					// If no more subscribers, remove the topic
					if (this.#topics[topic].size === 0) 
						delete this.#topics[topic];
				}

			}

			// Prepare SUBACK
			const suback = Buffer.alloc(4 + subscriptions.length);
			suback[0] = 0x90;  // SUBACK packet type
			suback[1] = 2 + subscriptions.length;  // Remaining length
			suback.writeUInt16BE(packetId, 2);  // Packet Identifier

			// Write return codes
			for (let i = 0; i < subscriptions.length; i++) {
			suback[i + 4] = subscriptions[i].qos;  // Granted QoS level
			}

			if (debug) console.log('SUBACK:', suback);
			socket.write(suback);
			if (debug) console.log(`Sent SUBACK to ${clientIP}:${clientPort}`);
		} catch (error) {
			console.error(`Error handling SUBSCRIBE from ${clientIP}:${clientPort}:`, error);
			// In case of error, send a failure SUBACK
			const suback = Buffer.from([0x90, 0x03, 0x00, 0x00, 0x80]);
			socket.write(suback);
		}
	}
	
	handlePingReq(socket) 
	{
		const clientIP = socket.remoteAddress;
		const clientPort = socket.remotePort;

		try 
		{
			// Respond with PINGRESP (message type 13)
			socket.write(Buffer.from([0xD0, 0x00]));
			if (debug) console.log(`Sent PINGRESP to ${clientIP}:${clientPort}`);
		} catch (error) 
		{
			console.error(`Error handling PINGREQ from ${clientIP}:${clientPort}:`, error);
		}
	}

	handleDisconnect(socket) 
	{
		const clientIP = socket.remoteAddress;
		const clientPort = socket.remotePort;
	
		if (debug) console.log(`Client initiated disconnect from ${clientIP}:${clientPort}`);
		this.#clients.delete(socket);
		
		// Remove this socket from all topic subscriptions
		for (let topic in this.#topics) 
		{
			this.#topics[topic].delete(socket);
			console.log('    Removed subscriber from topic:', topic);
			// If no more subscribers, remove the topic
			if (this.#topics[topic].size === 0)
			{
				delete this.#topics[topic];		
				console.log('    Deleted topic:', topic);
			}
		}
		
		// Close the socket
		this.emit('disconnect', socket);
		this.emit(`disconnect_${socket.clientId}`, socket);
		socket.end();
	}

	encodeVariableLength(length) 
	{
		const header = [];
		do {
			let byte = length % 128;
			length = Math.floor(length / 128);
			if (length > 0) {
				byte |= 128;
			}
			header.push(byte);
		} while (length > 0);
		return Buffer.from(header);
	}

	subscribeToTopic(socket, topic)
	{
		if (!socket) return;
		if (!this.#topics[topic]) 
			this.#topics[topic] = new Set();
		this.#topics[topic].add(socket);
		if (debug) console.log(`    Added subscriber ${socket.remoteAddress}:${socket.remotePort} to topic:`, topic);
	}

	publishToSubscribers(from, topic, content) 
	{
		if (this.#topics[topic]) 
		{			
			const publishPacket = Buffer.alloc(2 + topic.length + content.length);
			publishPacket.writeUInt16BE(topic.length, 0);
			publishPacket.write(topic, 2);
			publishPacket.write(content.toString(), 2 + topic.length);
		
			const sendPacket = Buffer.concat([Buffer.from([0x30]), this.encodeVariableLength(publishPacket.length), publishPacket]);
			if (debug) console.log('\nSend PUBLISH:', sendPacket);
			
			this.emit(topic, JSON.parse(content.toString()));
			try{}catch(err){}
			for (const subscriber of this.#topics[topic]) 
			{
				if (subscriber === from) continue;
		
				try 
				{
					subscriber.write(sendPacket);
					if (debug) console.log(`    Sent PUBLISH to ${subscriber.remoteAddress}:${subscriber.remotePort}`);
				}
				catch (error) 
				{
					console.error(`Error publishing to subscriber ${subscriber.remoteAddress}:${subscriber.remotePort}:`, error);
					this.#topics[topic].delete(subscriber);
				}
			}
		}
	}

	/**
	 * Disconnect a client
	 * @param {string} id - Client ID
	 */
	disconnect(id)
	{
		var simulateDisconnect = false;
		if (id && id.substring(0, 1) === "_")
		{
			id = id.substring(1);
			simulateDisconnect = true;
		}

		this.#clients.forEach(socket => 
		{
			if (id === undefined || socket.clientId === id)
				handleDisconnect(socket);
		});
	}
}

module.exports = MQTTServer;