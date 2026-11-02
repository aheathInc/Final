import '../core/l10n.dart';
import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:latlong2/latlong.dart';
import 'package:geolocator/geolocator.dart';
import 'package:url_launcher/url_launcher.dart';
import '../core/api.dart';
import 'patient_community_screen.dart' show records, messageError;

class PharmacyMapScreen extends StatefulWidget {
  const PharmacyMapScreen({super.key});
  @override
  State<PharmacyMapScreen> createState() => _PharmacyMapScreenState();
}

class _PharmacyMapScreenState extends State<PharmacyMapScreen> {
  final _map = MapController(), _drug = TextEditingController();
  LatLng? _location;
  List<Map<String, dynamic>> _rows = [];
  String? _error;
  bool _busy = false, _fullscreen = false, _medicineResults = false;
  int _request = 0;
  @override
  void initState() {
    super.initState();
    _search();
  }

  @override
  void dispose() {
    _map.dispose();
    _drug.dispose();
    super.dispose();
  }

  Future<void> _search() async {
    final request = ++_request;
    setState(() => _busy = true);
    try {
      final medicine = _drug.text.trim().isNotEmpty;
      final query = <String, dynamic>{
        if (_location != null) ...{
          'lat': _location!.latitude,
          'lng': _location!.longitude,
          'radius_km': 15
        },
        if (medicine) 'medication_name': _drug.text.trim(),
        if (!medicine) 'limit': 100
      };
      final r = await Api.get(
          medicine ? '/pharmacies/search-medication' : '/pharmacies',
          query: query);
      if (mounted && request == _request) {
        setState(() {
          _rows = records(r);
          _medicineResults = medicine;
          _error = r['truncated'] == true
              ? L.tr(
                  'Matokeo yamefikia kikomo; chagua eneo ili kupunguza utafutaji.')
              : null;
        });
      }
    } catch (e) {
      if (mounted && request == _request) {
        setState(() {
          _error = messageError(e);
          _rows = [];
        });
      }
    } finally {
      if (mounted && request == _request) setState(() => _busy = false);
    }
  }

  Future<void> _locate() async {
    final yes = await showDialog<bool>(
        context: context,
        builder: (c) => AlertDialog(
                title: Text(L.tr('Tumia eneo lako sasa?')),
                content: Text(L.tr(
                    'Eneo litatumwa kwa A-Health kutafuta pharmacies karibu nawe. Hatufuatilii eneo lako nyuma ya app. Unaweza pia kugusa ramani kuchagua eneo.')),
                actions: [
                  TextButton(
                      onPressed: () => Navigator.pop(c, false),
                      child: Text(L.tr('Ghairi'))),
                  FilledButton(
                      style: FilledButton.styleFrom(
                          minimumSize: const Size(0, 52)),
                      onPressed: () => Navigator.pop(c, true),
                      child: Text(L.tr('Endelea')))
                ]));
    if (yes != true) return;
    setState(() => _busy = true);
    try {
      if (!await Geolocator.isLocationServiceEnabled()) {
        throw Exception(
            L.tr('Washa location kwenye simu au chagua eneo kwenye ramani.'));
      }
      var p = await Geolocator.checkPermission();
      if (p == LocationPermission.denied) {
        p = await Geolocator.requestPermission();
      }
      if (p == LocationPermission.denied ||
          p == LocationPermission.deniedForever) {
        throw Exception(L.tr(
            'Ruhusa ya location haijatolewa. Chagua eneo kwenye ramani au badilisha ruhusa kwenye settings za simu.'));
      }
      final pos = await Geolocator.getCurrentPosition(
          locationSettings: const LocationSettings(
              accuracy: LocationAccuracy.medium,
              timeLimit: Duration(seconds: 20)));
      if (!mounted) return;
      setState(() => _location = LatLng(pos.latitude, pos.longitude));
      _map.move(_location!, 13);
      await _search();
    } catch (e) {
      if (mounted) {
        setState(() => _error = e.toString().replaceFirst('Exception: ', ''));
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Map<String, dynamic> _pharmacy(Map<String, dynamic> row) =>
      _medicineResults ? Map<String, dynamic>.from(row['pharmacy']) : row;
  String _availability(Map<String, dynamic> r) =>
      {
        'available': L.tr('Imetaarifiwa kuwa ipo'),
        'partially_available': L.tr('Kiasi hakitoshi'),
        'unavailable': L.tr('Haipo'),
        'unknown': L.tr('Stock haijathibitishwa')
      }[r['fulfillment_status']] ??
      L.tr('Stock haijathibitishwa');
  Widget _details(Map<String, dynamic> row) {
    final p = _pharmacy(row);
    return Padding(
        padding: const EdgeInsets.symmetric(vertical: 12),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(p['name'], style: Theme.of(context).textTheme.titleMedium),
          if (p['distance_km'] != null)
            Text(L.tr("{0} km kutoka eneo ulilochagua",
                [(p['distance_km'] as num).toStringAsFixed(1)])),
          if (p['location'] == null) Text(L.tr('Eneo halijarekodiwa')),
          if (_medicineResults) ...[
            Text('${row['medication_name']} · ${_availability(row)}'),
            if (row['quantity_on_hand'] != null)
              Text(L
                  .tr("Kiasi kilichoripotiwa: {0}", [row['quantity_on_hand']])),
            Text(L.tr("Taarifa ya mwisho: {0}",
                [row['last_reported_at'] ?? 'haijulikani'])),
            Text(L.tr(
                'Thibitisha kwa pharmacy kabla ya kusafiri. Taarifa ya zaidi ya saa 24 haithibitishi upatikanaji.'))
          ] else
            Text(L.tr(
                'Tafuta jina la dawa kuona taarifa za inventory zilizotolewa.')),
          if (p['opening_hours'] != null) Text(p['opening_hours']),
          if (p['contact_phone'] != null)
            TextButton.icon(
                onPressed: () async {
                  final uri = Uri(scheme: 'tel', path: p['contact_phone']);
                  if (!await launchUrl(uri) && mounted) {
                    setState(() => _error = L.tr(
                        "Imeshindikana kufungua simu. Piga {0}",
                        [p['contact_phone']]));
                  }
                },
                icon: const Icon(Icons.call_outlined),
                label: Text(p['contact_phone'])),
          const Divider()
        ]));
  }

  @override
  Widget build(BuildContext context) {
    Localizations.localeOf(context);
    final markers = <Marker>[];
    final seen = <String>{};
    for (final row in _rows) {
      final p = _pharmacy(row), location = p['location'];
      if (location is! Map || !seen.add(p['id'])) continue;
      markers.add(Marker(
          point: LatLng((location['lat'] as num).toDouble(),
              (location['lng'] as num).toDouble()),
          width: 48,
          height: 48,
          child: IconButton(
              icon: const Icon(Icons.local_pharmacy, size: 32),
              color: Theme.of(context).colorScheme.primary,
              tooltip: p['name'],
              onPressed: () => showModalBottomSheet(
                  context: context,
                  isScrollControlled: true,
                  builder: (_) => SafeArea(
                      child: SingleChildScrollView(
                          padding: const EdgeInsets.all(20),
                          child: _details(row)))))));
    }
    final map = FlutterMap(
        mapController: _map,
        options: MapOptions(
            initialCenter: const LatLng(-6.3, 35.5),
            initialZoom: 5,
            onTap: (_, point) {
              setState(() => _location = point);
              _search();
            }),
        children: [
          TileLayer(
              urlTemplate: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
              userAgentPackageName: 'tz.ahealth.patient'),
          MarkerLayer(markers: [
            ...markers,
            if (_location != null)
              Marker(
                  point: _location!,
                  width: 36,
                  height: 36,
                  child: const Icon(Icons.my_location, color: Colors.blue))
          ]),
          RichAttributionWidget(attributions: [
            TextSourceAttribution('OpenStreetMap contributors',
                onTap: () => launchUrl(
                    Uri.parse('https://www.openstreetmap.org/copyright')))
          ])
        ]);
    return Scaffold(
        appBar: AppBar(title: Text(L.tr('Pharmacy karibu nami')), actions: [
          IconButton(
              onPressed: () => setState(() => _fullscreen = !_fullscreen),
              icon:
                  Icon(_fullscreen ? Icons.fullscreen_exit : Icons.fullscreen),
              tooltip: _fullscreen
                  ? L.tr('Rudi kwenye orodha')
                  : L.tr('Ramani fullscreen'))
        ]),
        body: SafeArea(
            child: Column(children: [
          Padding(
              padding: const EdgeInsets.fromLTRB(16, 8, 16, 4),
              child: Row(children: [
                Expanded(
                    child: TextField(
                        controller: _drug,
                        onSubmitted: (_) => _search(),
                        decoration: InputDecoration(
                            labelText: L.tr('Tafuta dawa'),
                            suffixIcon: IconButton(
                                onPressed: _busy ? null : _search,
                                icon: const Icon(Icons.search),
                                tooltip: L.tr('Tafuta dawa'))))),
                IconButton(
                    onPressed: _busy ? null : _locate,
                    icon: const Icon(Icons.my_location),
                    tooltip: L.tr('Tumia eneo langu'))
              ])),
          Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
              child: Text(_location == null
                  ? L.tr(
                      'Gusa ramani kuchagua eneo au tumia location. Eneo la ramani linatumwa kwa OpenStreetMap kupakia tiles.')
                  : L.tr(
                      'Pharmacies ndani ya km 15. Gusa ramani kubadilisha eneo.'))),
          if (_error != null)
            Padding(
                padding: const EdgeInsets.all(12),
                child: Text(L.tr(_error!),
                    style:
                        TextStyle(color: Theme.of(context).colorScheme.error))),
          if (_busy) const LinearProgressIndicator(),
          Expanded(flex: _fullscreen ? 1 : 4, child: map),
          if (!_fullscreen)
            Expanded(
                flex: 3,
                child: RefreshIndicator(
                    onRefresh: _search,
                    child: ListView(
                        padding: const EdgeInsets.symmetric(horizontal: 20),
                        children: [
                          if (_rows.isEmpty && !_busy)
                            Padding(
                                padding: EdgeInsets.symmetric(vertical: 24),
                                child: Text(L.tr(
                                    'Hakuna pharmacy yenye taarifa zinazolingana na utafutaji huu. Jaribu eneo au dawa nyingine.'))),
                          for (final row in _rows) _details(row)
                        ])))
        ])));
  }
}
