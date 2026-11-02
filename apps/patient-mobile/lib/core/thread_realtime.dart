import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'api.dart';
import 'config.dart';

class ThreadRealtime {
  ThreadRealtime(this.threadId, this.changed, this.connected);
  final String threadId;
  final void Function() changed;
  final void Function(bool) connected;
  WebSocket? _socket;
  Timer? _retry;
  bool _closed = false;
  int _delay = 1;
  Future<void> start() async {
    try {
      final data = await Api.post('/realtime/token', {});
      if (_closed) return;
      var uri = Uri.parse(data['url'] as String);
      if (['127.0.0.1', 'localhost'].contains(uri.host)) {
        final api = Uri.parse(Config.baseUrlFor('/realtime'));
        uri = uri.replace(
            host: api.host,
            port: api.port,
            scheme: api.scheme == 'https' ? 'wss' : 'ws');
      }
      uri = uri.replace(queryParameters: {
        ...uri.queryParameters,
        'ticket': data['ticket'] as String
      });
      final socket = await WebSocket.connect(uri.toString());
      if (_closed) {
        await socket.close();
        return;
      }
      _socket = socket;
      socket.listen((raw) {
        try {
          final event = jsonDecode(raw as String) as Map;
          if (event['event'] == 'connected') {
            _delay = 1;
            connected(true);
            changed();
          } else if (event['careThreadId'] == threadId) {
            changed();
          }
        } catch (_) {/* polling recovers missed or invalid events */}
      },
          onDone: _reconnect,
          onError: (_) => socket.close(),
          cancelOnError: false);
    } catch (_) {
      _reconnect();
    }
  }

  void _reconnect() {
    if (_closed) return;
    connected(false);
    _retry?.cancel();
    _retry = Timer(Duration(seconds: _delay), start);
    _delay = (_delay * 2).clamp(1, 30);
  }

  void close() {
    _closed = true;
    _retry?.cancel();
    _socket?.close();
  }
}
