import '../core/l10n.dart';
import 'package:flutter/material.dart';

import '../core/api.dart';
import '../core/phone.dart';
import '../core/patient_care.dart';
import '../core/strings.dart';
import '../core/theme.dart';
import '../widgets/common.dart';
import 'consultation_detail_screen.dart';

class NewConsultationScreen extends StatefulWidget {
  const NewConsultationScreen({
    super.key,
    this.clinicianId,
    this.clinicianName,
    this.facilityId,
    this.facilityName,
    this.clinicianSpecialty,
    this.repository,
  });
  final String? clinicianId;
  final String? clinicianName;
  final String? facilityId;
  final String? facilityName;
  final String? clinicianSpecialty;
  final PatientCareRepository? repository;

  @override
  State<NewConsultationScreen> createState() => _NewConsultationScreenState();
}

class _NewConsultationScreenState extends State<NewConsultationScreen> {
  final _symptoms = TextEditingController();
  int _severity = 5;
  int _days = 1;
  bool _busy = false;
  String? _error;
  String? _submissionOpId;
  String? _mode;
  String _modality = 'chat';
  String? _facilityId;
  Map<String, dynamic>? _options;
  bool _loadingOptions = true;
  late final PatientCareRepository _care;

  @override
  void initState() {
    super.initState();
    _care = widget.repository ?? PatientCareRepository();
    _facilityId = widget.facilityId;
    _loadOptions();
  }

  Future<void> _loadOptions() async {
    setState(() {
      _loadingOptions = true;
      _error = null;
    });
    try {
      final options = await _care.consultationOptions();
      if (mounted) setState(() => _options = options);
    } catch (_) {
      if (mounted)
        setState(() =>
            _error = L.tr('Njia za consultation hazijapatikana. Jaribu tena.'));
    } finally {
      if (mounted) setState(() => _loadingOptions = false);
    }
  }

  String get _feeLabel {
    final fees = _options?['remote_fees'] as Map?;
    if (fees == null) return L.tr('Ada haijapatikana');
    final general = fees['general_practice'];
    final specialist = fees['specialist'];
    if (widget.clinicianSpecialty != null) {
      return 'TZS ${widget.clinicianSpecialty == 'general_practice' ? general : specialist}';
    }
    return L.tr("TZS {0} (General Practice) / TZS {1} (specialist)",
        [general, specialist]);
  }

  @override
  void dispose() {
    _symptoms.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (_busy || _mode == null || _options == null) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    final opId = _submissionOpId ??= newOpId();
    try {
      final consultation = await _care.createConsultation(
        opId: opId,
        body: {
          'channel': 'app',
          'consultation_mode': _mode,
          'modality': _mode == 'hospital' ? 'in_person' : _modality,
          if (_mode == 'hospital') 'facility_id': _facilityId,
          if (widget.clinicianId != null) 'clinician_id': widget.clinicianId,
          'symptom_text': _symptoms.text,
          'structured_symptoms': [
            {
              'code': 'general',
              'severity': _severity,
              'duration_hours': _days * 24,
            },
          ],
        },
      );
      if (!mounted) return;
      _submissionOpId = null;
      Navigator.of(context).pushReplacement(
        MaterialPageRoute(
          builder: (_) => ConsultationDetailScreen(
            consultation: consultation.data,
            requestedClinicianName: widget.clinicianName,
          ),
        ),
      );
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() {
        _error = e.message;
        _busy = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = S.errorGeneric;
        _busy = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    Localizations.localeOf(context);
    return Scaffold(
      appBar: AppBar(title: Text(S.homeGetHelp)),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.all(20),
          children: [
            Text(L.tr('Utapata consultation kwa njia gani?'),
                style: TextStyle(fontSize: 22, fontWeight: FontWeight.w600)),
            if (widget.clinicianName != null)
              Padding(
                padding: const EdgeInsets.only(top: 8),
                child: Text(L.tr("Daktari: {0}", [widget.clinicianName])),
              ),
            const SizedBox(height: 12),
            RadioGroup<String>(
                groupValue: _mode,
                onChanged: (v) {
                  if (!_busy)
                    setState(() {
                      _mode = v;
                      _submissionOpId = null;
                    });
                },
                child: Column(children: [
                  RadioListTile<String>(
                    value: 'hospital',
                    enabled: !_busy,
                    title: Text(L.tr('Hospital consultation')),
                    subtitle: Text(L.tr(
                        'Utafika hospitalini kuonana na daktari. Hakuna consultation fee.')),
                    contentPadding: EdgeInsets.zero,
                  ),
                  RadioListTile<String>(
                    value: 'remote',
                    enabled: !_busy,
                    title: Text(L.tr('Remote consultation')),
                    subtitle: Text(L.tr(
                        'Zungumza na daktari ulipo kwa video, sauti au chat. Ina consultation fee.')),
                    contentPadding: EdgeInsets.zero,
                  ),
                ])),
            if (_loadingOptions) const LinearProgressIndicator(),
            if (!_loadingOptions && _options == null)
              OutlinedButton(
                  onPressed: _loadOptions,
                  child: Text(L.tr('Jaribu kupakia njia tena'))),
            if (_mode == 'hospital' && _options != null) ...[
              const SizedBox(height: 12),
              if (widget.facilityId != null)
                Text(L.tr("Hospital: {0}",
                    [widget.facilityName ?? widget.facilityId]))
              else
                DropdownButtonFormField<String>(
                  initialValue: _facilityId,
                  isExpanded: true,
                  decoration:
                      InputDecoration(labelText: L.tr('Hospital utakayofika')),
                  items: ((_options!['facilities'] as List?) ?? [])
                      .map((f) => DropdownMenuItem<String>(
                            value: f['id'] as String,
                            child: Text(f['name'] as String,
                                overflow: TextOverflow.ellipsis),
                          ))
                      .toList(),
                  onChanged: _busy
                      ? null
                      : (v) => setState(() {
                            _facilityId = v;
                            _submissionOpId = null;
                          }),
                ),
              const SizedBox(height: 8),
              Text(
                  L.tr(
                      'Consultation fee: TZS 0. Vipimo na dawa ni gharama tofauti: hospitali itoe bei ya kila huduma na ipate idhini yako kabla ya malipo.'),
                  style: TextStyle(color: AppPalette.of(context).inkSoft)),
            ],
            if (_mode == 'remote') ...[
              const SizedBox(height: 12),
              Text(L.tr('Njia ya mawasiliano'),
                  style: TextStyle(fontWeight: FontWeight.w600)),
              const SizedBox(height: 8),
              Wrap(spacing: 8, runSpacing: 8, children: [
                for (final option in [
                  ('video', L.tr('Video call'), Icons.videocam_outlined),
                  ('voice', L.tr('Audio call'), Icons.call_outlined),
                  ('chat', L.tr('Live chat'), Icons.chat_bubble_outline)
                ])
                  ChoiceChip(
                      avatar: Icon(option.$3, size: 18),
                      label: Text(option.$2),
                      selected: _modality == option.$1,
                      onSelected: _busy
                          ? null
                          : (_) => setState(() {
                                _modality = option.$1;
                                _submissionOpId = null;
                              })),
              ]),
              const SizedBox(height: 12),
              Text(L.tr("Consultation fee: {0}", [_feeLabel]),
                  style: const TextStyle(fontWeight: FontWeight.w600)),
              Text(L.tr(
                  'Vipimo na dawa hazijajumuishwa. Hospitali itoe bei ya kila huduma na ipate idhini yako kabla ya malipo.')),
              const SizedBox(height: 6),
              Text(
                  L.tr(
                      'Bili itapatikana daktari akikubali ombi. Kutuma ombi hakukati pesa kwenye akaunti yako.'),
                  style: TextStyle(color: AppPalette.of(context).inkSoft)),
            ],
            const SizedBox(height: 28),
            Text(
              L.tr('Eleza tatizo lako kwa maneno yako mwenyewe.'),
              style: TextStyle(color: AppColors.inkSoft, fontSize: 16),
            ),
            const SizedBox(height: 16),
            TextField(
              controller: _symptoms,
              maxLines: 5,
              enabled: !_busy,
              maxLength: 4000,
              decoration: InputDecoration(
                hintText:
                    L.tr('Mfano: Nina homa na kichwa kinauma tangu jana.'),
              ),
              onChanged: (_) {
                _submissionOpId = null;
                setState(() {});
              },
            ),

            const SizedBox(height: 28),
            Text(
              L.tr('Inaumiza kiasi gani?'),
              style: TextStyle(fontWeight: FontWeight.w500),
            ),
            // 1-10 rather than words: the triage engine weighs this number, and
            // a slider gives the same scale to everyone regardless of how they
            // would describe pain.
            Slider(
              value: _severity.toDouble(),
              min: 1,
              max: 10,
              divisions: 9,
              label: '$_severity',
              activeColor: AppColors.petrol,
              onChanged: _busy
                  ? null
                  : (v) {
                      _submissionOpId = null;
                      setState(() => _severity = v.round());
                    },
            ),
            Text(
              L.tr("{0} kati ya 10", [_severity]),
              style: const TextStyle(color: AppColors.inkSoft),
            ),

            const SizedBox(height: 24),
            Text(
              L.tr('Kimeanza siku ngapi zilizopita?'),
              style: TextStyle(fontWeight: FontWeight.w500),
            ),
            const SizedBox(height: 8),
            Wrap(
              runSpacing: 8,
              children: [1, 2, 3, 7, 14, 30].map((d) {
                final selected = _days == d;
                return Padding(
                  padding: const EdgeInsets.only(right: 8),
                  child: ChoiceChip(
                    label: Text(d == 1 ? L.tr('Leo') : '$d'),
                    selected: selected,
                    onSelected: _busy
                        ? null
                        : (_) {
                            _submissionOpId = null;
                            setState(() => _days = d);
                          },
                    selectedColor: AppColors.petrol,
                    labelStyle: TextStyle(
                      color: selected ? Colors.white : AppColors.ink,
                    ),
                    shape: const RoundedRectangleBorder(),
                  ),
                );
              }).toList(),
            ),

            if (_error != null) ...[
              const SizedBox(height: 16),
              Notice(_error!),
            ],

            const SizedBox(height: 32),
            FilledButton(
              onPressed: _busy ||
                      _symptoms.text.trim().isEmpty ||
                      _mode == null ||
                      _options == null ||
                      (_mode == 'hospital' && _facilityId == null)
                  ? null
                  : _submit,
              child: Text(
                  _busy ? 'Inatuma...' : L.tr('Tuma ombi la consultation')),
            ),
          ],
        ),
      ),
    );
  }
}
