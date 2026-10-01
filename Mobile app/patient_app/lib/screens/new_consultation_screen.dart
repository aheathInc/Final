import 'package:flutter/material.dart';
import '../core/api.dart';
import '../core/phone.dart';
import '../core/patient_care.dart';
import '../core/strings.dart';
import '../core/theme.dart';
import '../widgets/common.dart';
import 'consultation_detail_screen.dart';

class NewConsultationScreen extends StatefulWidget {
  const NewConsultationScreen({super.key, this.clinicianId, this.clinicianName});
  final String? clinicianId;
  final String? clinicianName;

  @override
  State<NewConsultationScreen> createState() => _NewConsultationScreenState();
}

class _NewConsultationScreenState extends State<NewConsultationScreen> {
  final _symptoms = TextEditingController();
  int _severity = 5;
  int _days = 1;
  bool _busy = false;
  String? _error;
  bool _queued = false;
  String? _submissionOpId;

  @override
  void dispose() {
    _symptoms.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    setState(() { _busy = true; _error = null; });
    final opId = _submissionOpId ??= newOpId();
    try {
      final consultation = await PatientCareRepository().createConsultation(
        opId: opId,
        body: {
          'channel': 'app',
          if (widget.clinicianId != null) 'clinician_id': widget.clinicianId,
          'symptom_text': _symptoms.text,
          'structured_symptoms': [
            {
              'code': 'general',
              'severity': _severity,
              'duration_hours': _days * 24,
            }
          ],
        },
      );
      if (!mounted) return;
      _submissionOpId = null;
      Navigator.of(context).pushReplacement(MaterialPageRoute(
        builder: (_) => ConsultationDetailScreen(
          consultation: consultation.data,
          requestedClinicianName: widget.clinicianName,
        ),
      ));
    } on Queued {
      setState(() { _queued = true; _busy = false; });
    } on ApiException catch (e) {
      setState(() { _error = e.message; _busy = false; });
    } catch (e) {
      setState(() { _error = S.errorGeneric; _busy = false; });
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_queued) {
      return Scaffold(
        appBar: AppBar(),
        body: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
            const Notice(
                'Ombi limehifadhiwa kwenye simu, lakini bado halijathibitishwa na seva. '
                'Litatumwa mtandao ukirudi; usidhani daktari amelipokea hadi hali ionekane kwenye programu.',
                tone: NoticeTone.attention,
              ),
              const SizedBox(height: 24),
              FilledButton(
                onPressed: () => Navigator.of(context).pop(),
                child: const Text('Sawa'),
              ),
            ],
          ),
        ),
      );
    }

    return Scaffold(
      appBar: AppBar(title: const Text(S.homeGetHelp)),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.all(20),
          children: [
            const Text('Eleza tatizo lako kwa maneno yako mwenyewe.',
                style: TextStyle(color: AppColors.inkSoft, fontSize: 16)),
            const SizedBox(height: 16),
            TextField(
              controller: _symptoms,
              maxLines: 5,
              autofocus: true,
              decoration: const InputDecoration(
                hintText: 'Mfano: Nina homa na kichwa kinauma tangu jana.',
              ),
              onChanged: (_) { _submissionOpId = null; setState(() {}); },
            ),

            const SizedBox(height: 28),
            const Text('Inaumiza kiasi gani?', style: TextStyle(fontWeight: FontWeight.w500)),
            // 1-10 rather than words: the triage engine weighs this number, and
            // a slider gives the same scale to everyone regardless of how they
            // would describe pain.
            Slider(
              value: _severity.toDouble(),
              min: 1, max: 10, divisions: 9,
              label: '$_severity',
              activeColor: AppColors.petrol,
              onChanged: (v) { _submissionOpId = null; setState(() => _severity = v.round()); },
            ),
            Text('$_severity kati ya 10',
                style: const TextStyle(color: AppColors.inkSoft)),

            const SizedBox(height: 24),
            const Text('Kimeanza siku ngapi zilizopita?',
                style: TextStyle(fontWeight: FontWeight.w500)),
            const SizedBox(height: 8),
            Row(
              children: [1, 2, 3, 7, 14, 30].map((d) {
                final selected = _days == d;
                return Padding(
                  padding: const EdgeInsets.only(right: 8),
                  child: ChoiceChip(
                    label: Text(d == 1 ? 'Leo' : '$d'),
                    selected: selected,
                    onSelected: (_) { _submissionOpId = null; setState(() => _days = d); },
                    selectedColor: AppColors.petrol,
                    labelStyle: TextStyle(color: selected ? Colors.white : AppColors.ink),
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
              onPressed: _busy || _symptoms.text.trim().isEmpty ? null : _submit,
              child: Text(_busy ? 'Inatuma...' : S.send),
            ),
          ],
        ),
      ),
    );
  }
}
