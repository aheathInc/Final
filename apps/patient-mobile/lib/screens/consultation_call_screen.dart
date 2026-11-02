import '../core/l10n.dart';
import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_webrtc/flutter_webrtc.dart';
import '../core/api.dart';
import '../core/theme.dart';

class ConsultationCallScreen extends StatefulWidget {
  const ConsultationCallScreen(
      {super.key, required this.consultationId, required this.video});
  final String consultationId;
  final bool video;
  @override
  State<ConsultationCallScreen> createState() => _ConsultationCallScreenState();
}

class _ConsultationCallScreenState extends State<ConsultationCallScreen>
    with WidgetsBindingObserver {
  final _local = RTCVideoRenderer();
  final _remote = RTCVideoRenderer();
  RTCPeerConnection? _peer;
  MediaStream? _stream;
  Map<String, dynamic>? _state;
  String? _callId;
  Timer? _timer;
  bool _busy = false,
      _polling = false,
      _ready = false,
      _muted = false,
      _cameraOff = false;
  bool _fullscreen = false, _frontCamera = true;
  String _status = L.tr('Inapakia call…');
  String? _error;
  String get _base => '/consultations/${widget.consultationId}/call';
  Map? get _incoming => _state?['call'] as Map?;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _init();
  }

  Future<void> _init() async {
    await _local.initialize();
    await _remote.initialize();
    if (!mounted) return;
    setState(() {
      _ready = true;
      _status = L.tr('Unasubiri daktari aanzishe call.');
    });
    await _poll();
    if (mounted)
      _timer = Timer.periodic(const Duration(seconds: 2), (_) => _poll());
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.paused && _peer != null) unawaited(_end());
  }

  Future<void> _poll() async {
    if (_polling || _busy || !mounted) return;
    _polling = true;
    try {
      final data = Map<String, dynamic>.from(await Api.get(_base) as Map);
      if (!mounted) return;
      setState(() => _state = data);
      final call = data['call'] as Map?;
      if (_callId != null && call?['id'] != _callId) {
        await _release();
        if (mounted)
          setState(
              () => _status = L.tr('Call imeisha au muda wa kujibu umepita.'));
      } else if (_peer == null) {
        setState(() => _status = call == null
            ? L.tr('Unasubiri daktari aanzishe call.')
            : call['answer'] != null
                ? L.tr('Call imepokelewa kwenye kifaa kingine.')
                : L.tr('Daktari anakupigia. Pokea ukiwa tayari.'));
      }
    } on ApiException catch (e) {
      if ([401, 403, 404, 409].contains(e.status)) await _release();
      if (mounted)
        setState(() {
          _error = e.message;
          _status = L.tr('Call haipatikani kwa sasa.');
        });
    } catch (_) {
      if (mounted)
        setState(() =>
            _error = L.tr('Hali ya call haipatikani. Angalia mtandao wako.'));
    } finally {
      _polling = false;
    }
  }

  Future<void> _release() async {
    final media = _stream;
    _stream = null;
    final pc = _peer;
    _peer = null;
    _callId = null;
    _local.srcObject = null;
    _remote.srcObject = null;
    if (media != null) {
      for (final track in media.getTracks()) {
        await track.stop();
      }
      await media.dispose();
    }
    await pc?.close();
    await pc?.dispose();
    if (mounted)
      setState(() {
        _muted = false;
        _cameraOff = false;
        _frontCamera = true;
      });
  }

  Future<void> _end() async {
    final id = _callId ?? _incoming?['id'] as String?;
    await _release();
    if (mounted)
      setState(() {
        _status = L.tr('Call imeisha.');
        _state?['call'] = null;
      });
    if (id != null) {
      try {
        await Api.post('$_base/$id/end', {});
      } catch (_) {
        if (mounted)
          setState(() => _error = L.tr(
              'Camera na microphone zimezimwa. Mtandao ukirudi, sasisha hali ya call.'));
      }
    }
  }

  Future<void> _connect(Map incoming) async {
    if (_busy ||
        !_ready ||
        _state?['available'] != true ||
        incoming['is_caller'] == true ||
        incoming['answer'] != null) return;
    setState(() {
      _busy = true;
      _error = null;
      _status = L.tr(
          "Inaunganisha microphone{0}…", [widget.video ? ' na kamera' : '']);
    });
    try {
      final media = await navigator.mediaDevices.getUserMedia({
        'audio': true,
        'video': widget.video ? {'facingMode': 'user'} : false,
      });
      if (!mounted) {
        for (final t in media.getTracks()) {
          await t.stop();
        }
        await media.dispose();
        return;
      }
      _stream = media;
      _local.srcObject = media;
      final pc = await createPeerConnection({
        'iceServers': _state!['ice_servers'],
        'sdpSemantics': 'unified-plan'
      });
      if (!mounted) {
        await pc.close();
        await pc.dispose();
        return;
      }
      _peer = pc;
      for (final track in media.getTracks()) {
        await pc.addTrack(track, media);
      }
      pc.onTrack = (event) {
        if (mounted && event.streams.isNotEmpty)
          setState(() => _remote.srcObject = event.streams.first);
      };
      pc.onConnectionState = (state) {
        if (!mounted) return;
        if (state == RTCPeerConnectionState.RTCPeerConnectionStateConnected)
          setState(() => _status = L.tr('Umeunganishwa'));
        if (state == RTCPeerConnectionState.RTCPeerConnectionStateDisconnected)
          setState(
              () => _status = L.tr('Mtandao umekatika. Inaunganisha tena…'));
        if (state == RTCPeerConnectionState.RTCPeerConnectionStateFailed) {
          setState(() => _error = L
              .tr('Call haijaunganishwa. Angalia mtandao kisha ujaribu tena.'));
          unawaited(_end());
        }
      };
      final gathered = Completer<void>();
      pc.onIceGatheringState = (state) {
        if (state == RTCIceGatheringState.RTCIceGatheringStateComplete &&
            !gathered.isCompleted) gathered.complete();
      };
      await pc.setRemoteDescription(
          RTCSessionDescription(incoming['offer'] as String, 'offer'));
      await pc.setLocalDescription(await pc.createAnswer());
      await gathered.future
          .timeout(const Duration(seconds: 12), onTimeout: () {});
      if (!mounted || _peer != pc) return;
      final description = await pc.getLocalDescription();
      _callId = incoming['id'] as String;
      final response =
          await Api.post('$_base/$_callId/answer', {'sdp': description!.sdp});
      if (mounted) {
        setState(() {
          _state = Map<String, dynamic>.from(response as Map);
          if (_status != L.tr('Umeunganishwa')) {
            _status = L.tr('Inaunganisha na daktari…');
          }
        });
      }
    } catch (e) {
      final id = _callId;
      await _release();
      if (id != null)
        unawaited(Api.post('$_base/$id/end', {}).catchError((_) => null));
      if (mounted)
        setState(() {
          _status = L.tr('Call haijaunganishwa.');
          _error = e is ApiException
              ? e.message
              : L.tr(
                  "Ruhusu microphone{0} kwenye Settings, kisha ujaribu tena.",
                  [widget.video ? ' na kamera' : '']);
        });
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  void dispose() {
    if (_fullscreen)
      unawaited(SystemChrome.setEnabledSystemUIMode(SystemUiMode.edgeToEdge));
    WidgetsBinding.instance.removeObserver(this);
    _timer?.cancel();
    final id = _callId;
    if (id != null)
      unawaited(Api.post('$_base/$id/end', {}).catchError((_) => null));
    unawaited(_release().then((_) async {
      await _local.dispose();
      await _remote.dispose();
    }));
    super.dispose();
  }

  Future<void> _toggleFullscreen() async {
    setState(() => _fullscreen = !_fullscreen);
    await SystemChrome.setEnabledSystemUIMode(
        _fullscreen ? SystemUiMode.immersiveSticky : SystemUiMode.edgeToEdge);
  }

  Widget _control(String label, IconData icon, VoidCallback? action,
          {bool danger = false}) =>
      SizedBox(
        width: 80,
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          IconButton.filled(
              tooltip: label,
              onPressed: action,
              style: IconButton.styleFrom(
                  minimumSize: const Size(52, 52),
                  backgroundColor:
                      danger ? AppColors.clay : AppPalette.dark.paperSunk,
                  foregroundColor: Colors.white),
              icon: Icon(icon)),
          const SizedBox(height: 4),
          Text(L.tr(label),
              textAlign: TextAlign.center,
              style: TextStyle(color: AppPalette.dark.ink, fontSize: 12)),
        ]),
      );

  @override
  Widget build(BuildContext context) {
    Localizations.localeOf(context);
    final incoming = _peer == null &&
        _incoming != null &&
        _incoming!['is_caller'] != true &&
        _incoming!['answer'] == null;
    const palette = AppPalette.dark;
    return PopScope(
      canPop: !_fullscreen,
      onPopInvokedWithResult: (didPop, result) {
        if (!didPop && _fullscreen) _toggleFullscreen();
      },
      child: Theme(
          data: buildDarkTheme(),
          child: Scaffold(
            backgroundColor: palette.paper,
            appBar: _fullscreen
                ? null
                : AppBar(
                    title: Text(widget.video
                        ? L.tr('Video consultation')
                        : L.tr('Audio consultation'))),
            body: SafeArea(
                child: Column(children: [
              Padding(
                  padding: const EdgeInsets.fromLTRB(16, 8, 8, 8),
                  child: Row(children: [
                    Expanded(
                        child: Semantics(
                            liveRegion: true,
                            child: Text(_status,
                                style: TextStyle(color: palette.ink)))),
                    if (widget.video)
                      IconButton(
                          onPressed: _toggleFullscreen,
                          tooltip: _fullscreen
                              ? L.tr('Ondoka fullscreen')
                              : L.tr('Fullscreen'),
                          icon: Icon(_fullscreen
                              ? Icons.fullscreen_exit
                              : Icons.fullscreen)),
                  ])),
              if (_error != null || _state?['available'] == false)
                Padding(
                    padding:
                        const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                    child: Text(
                        _error ??
                            L.tr(
                                'Huduma ya calls bado haijawezeshwa. Wasiliana na mtoa huduma.'),
                        style: TextStyle(color: palette.clay))),
              Expanded(
                  child: Padding(
                      padding: EdgeInsets.symmetric(
                          horizontal: _fullscreen ? 0 : 12),
                      child: ClipRRect(
                          borderRadius:
                              BorderRadius.circular(_fullscreen ? 0 : 16),
                          child: ColoredBox(
                            color: palette.surface,
                            child: Stack(fit: StackFit.expand, children: [
                              if (_ready &&
                                  widget.video &&
                                  _remote.srcObject != null)
                                RTCVideoView(_remote,
                                    objectFit: RTCVideoViewObjectFit
                                        .RTCVideoViewObjectFitContain)
                              else
                                Center(
                                    child: Column(
                                        mainAxisSize: MainAxisSize.min,
                                        children: [
                                      CircleAvatar(
                                          radius: 36,
                                          backgroundColor: palette.paperSunk,
                                          child: Icon(
                                              widget.video
                                                  ? Icons.videocam_outlined
                                                  : Icons.call_outlined,
                                              size: 32,
                                              color: palette.ink)),
                                      const SizedBox(height: 12),
                                      Text(
                                          _peer == null
                                              ? L.tr(
                                                  'Daktari ndiye anayeanzisha call')
                                              : L.tr('Daktari'),
                                          style: TextStyle(color: palette.ink)),
                                    ])),
                              Positioned(
                                  left: 12,
                                  bottom: 12,
                                  child: DecoratedBox(
                                      decoration: BoxDecoration(
                                          color: palette.paper,
                                          borderRadius:
                                              BorderRadius.circular(8)),
                                      child: Padding(
                                          padding: const EdgeInsets.symmetric(
                                              horizontal: 10, vertical: 6),
                                          child: Text(L.tr('Daktari'),
                                              style: TextStyle(
                                                  color: palette.ink))))),
                              if (_ready && widget.video && _peer != null)
                                Positioned(
                                    right: 12,
                                    top: 12,
                                    width: 104,
                                    height: 132,
                                    child: ClipRRect(
                                        borderRadius: BorderRadius.circular(12),
                                        child: ColoredBox(
                                            color: palette.paperSunk,
                                            child: Stack(
                                                fit: StackFit.expand,
                                                children: [
                                                  if (!_cameraOff)
                                                    RTCVideoView(_local,
                                                        mirror: _frontCamera)
                                                  else
                                                    Icon(Icons.videocam_off,
                                                        color: palette.ink),
                                                  Positioned(
                                                      bottom: 4,
                                                      left: 6,
                                                      child: DecoratedBox(
                                                          decoration: BoxDecoration(
                                                              color:
                                                                  palette.paper,
                                                              borderRadius:
                                                                  BorderRadius
                                                                      .circular(
                                                                          4)),
                                                          child: Padding(
                                                              padding:
                                                                  const EdgeInsets.all(
                                                                      4),
                                                              child: Text(
                                                                  L.tr('Wewe'),
                                                                  style: TextStyle(
                                                                      color: palette
                                                                          .ink,
                                                                      fontSize:
                                                                          12))))),
                                                ])))),
                            ]),
                          )))),
              Padding(
                  padding: const EdgeInsets.all(12),
                  child: Column(mainAxisSize: MainAxisSize.min, children: [
                    if (incoming)
                      FilledButton.icon(
                          onPressed:
                              _busy || !_ready || _state?['available'] != true
                                  ? null
                                  : () => _connect(_incoming!),
                          icon: const Icon(Icons.call),
                          label: Text(L.tr('Pokea call'))),
                    if (incoming) const SizedBox(height: 8),
                    Wrap(
                        alignment: WrapAlignment.center,
                        spacing: 6,
                        runSpacing: 8,
                        children: [
                          if (_peer != null)
                            _control(
                                _muted
                                    ? L.tr('Washa microphone')
                                    : L.tr('Zima microphone'),
                                _muted ? Icons.mic_off : Icons.mic, () {
                              for (final track in _stream?.getAudioTracks() ??
                                  <MediaStreamTrack>[]) {
                                track.enabled = _muted;
                              }
                              setState(() => _muted = !_muted);
                            }),
                          if (_peer != null && widget.video)
                            _control(
                                _cameraOff
                                    ? L.tr('Washa kamera')
                                    : L.tr('Zima kamera'),
                                _cameraOff
                                    ? Icons.videocam_off
                                    : Icons.videocam, () {
                              for (final track in _stream?.getVideoTracks() ??
                                  <MediaStreamTrack>[]) {
                                track.enabled = _cameraOff;
                              }
                              setState(() => _cameraOff = !_cameraOff);
                            }),
                          if (_peer != null && widget.video)
                            _control(
                                L.tr('Geuza kamera'),
                                Icons.cameraswitch_outlined,
                                _cameraOff
                                    ? null
                                    : () async {
                                        final tracks =
                                            _stream?.getVideoTracks();
                                        if (tracks != null &&
                                            tracks.isNotEmpty) {
                                          try {
                                            final frontCamera =
                                                await Helper.switchCamera(
                                                    tracks.first);
                                            if (mounted)
                                              setState(() =>
                                                  _frontCamera = frontCamera);
                                          } catch (_) {
                                            if (mounted)
                                              setState(() => _error = L.tr(
                                                  'Kamera haijabadilika. Jaribu tena.'));
                                          }
                                        }
                                      }),
                          if (_peer != null || incoming)
                            _control(
                                _peer == null
                                    ? L.tr('Kataa call')
                                    : L.tr('Maliza call'),
                                Icons.call_end,
                                _busy ? null : _end,
                                danger: true),
                        ]),
                    if (_peer == null)
                      Padding(
                          padding: const EdgeInsets.only(top: 10),
                          child: Text(
                              L.tr(
                                  'Kamera na microphone huanza unapopokea call. Ukiondoka hapa, call itaisha.'),
                              textAlign: TextAlign.center,
                              style: TextStyle(
                                  color: palette.inkSoft, fontSize: 12))),
                  ])),
            ])),
          )),
    );
  }
}
