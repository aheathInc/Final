import 'package:flutter/material.dart';

import '../core/api.dart';
import '../core/consent_feedback_finance.dart';
import '../widgets/common.dart';

const _incidentCategories = <String>[
  'clinical_care',
  'misconduct',
  'medication_error',
  'delayed_response',
  'data_privacy',
  'ai_error',
  'other',
];

class FeedbackScreen extends StatefulWidget {
  const FeedbackScreen({super.key, this.initialConsultationId});

  final String? initialConsultationId;

  @override
  State<FeedbackScreen> createState() => _FeedbackScreenState();
}

class _FeedbackScreenState extends State<FeedbackScreen> {
  final _repository = ConsentFeedbackFinanceRepository();
  final _ratingComment = TextEditingController();
  final _incidentDescription = TextEditingController();
  List<Map<String, dynamic>> _completed = [];
  Map<String, dynamic>? _rating;
  Map<String, dynamic>? _incident;
  String? _consultationId;
  String? _incidentConsultationId;
  String _category = _incidentCategories.first;
  String? _error;
  int _score = 5;
  bool _anonymous = false;
  bool _loading = true;
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    _consultationId = widget.initialConsultationId;
    _loadCompleted();
  }

  @override
  void dispose() {
    _ratingComment.dispose();
    _incidentDescription.dispose();
    super.dispose();
  }

  Future<void> _loadCompleted() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final response = await Api.get(
        '/consultations',
        query: {'status': 'completed', 'limit': 50},
      );
      final data = response is Map ? response['data'] : null;
      if (data is! List) {
        throw const FormatException('Consultations response is invalid');
      }
      final rows = data
          .whereType<Map>()
          .map((row) => Map<String, dynamic>.from(row))
          .where((row) => row['status'] == 'completed' && row['id'] is String)
          .toList();
      if (!mounted) return;
      final requestedId = widget.initialConsultationId;
      final requestedFound =
          requestedId == null || rows.any((row) => row['id'] == requestedId);
      setState(() {
        _completed = rows;
        if (!requestedFound) {
          _consultationId = null;
          _error = 'Ombi hili halipo kwenye orodha ya matibabu yaliyokamilika.';
        } else if (_consultationId == null ||
            !rows.any((row) => row['id'] == _consultationId)) {
          _consultationId = rows.isEmpty ? null : rows.first['id'] as String;
        }
        _loading = false;
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _error = error is ApiException
            ? error.message
            : 'Matibabu yaliyokamilika hayakusomeka.';
        _loading = false;
      });
    }
  }

  String _errorMessage(Object error) {
    if (error is ApiException && error.code == 'ALREADY_RATED') {
      return 'Tathmini ya ombi hili tayari imetumwa.';
    }
    return error is ApiException
        ? '${error.message} (${error.code ?? error.status})'
        : 'Ombi halikuhifadhiwa. Jaribu tena.';
  }

  Future<void> _submitRating() async {
    final consultationId = _consultationId;
    if (consultationId == null || _rating != null) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final saved = await _repository.rateConsultation(
        consultationId,
        score: _score,
        comment: _ratingComment.text,
      );
      if (!mounted) return;
      setState(() {
        _rating = saved;
        _busy = false;
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _error = _errorMessage(error);
        _busy = false;
      });
    }
  }

  Future<void> _submitIncident() async {
    final description = _incidentDescription.text.trim();
    if (description.isEmpty || _busy) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final saved = await _repository.createIncident({
        'category': _category,
        'description': description,
        'anonymous': _anonymous,
        if (_incidentConsultationId != null &&
            _incidentConsultationId!.isNotEmpty)
          'consultation_id': _incidentConsultationId,
      });
      if (!mounted) return;
      setState(() {
        _incident = saved;
        _incidentDescription.clear();
        _busy = false;
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _error = _errorMessage(error);
        _busy = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(title: const Text('Maoni na malalamiko')),
        body: RefreshIndicator(
          onRefresh: _loadCompleted,
          child: ListView(
            padding: const EdgeInsets.all(20),
            children: [
              if (_error != null) ...[
                Notice(_error!),
                const SizedBox(height: 12)
              ],
              const SectionTitle('Tathmini ya matibabu yaliyokamilika'),
              const Text(
                'Tathmini hutumwa kwa huduma ya ubora; tathmini moja inaruhusiwa kwa kila ombi.',
              ),
              const SizedBox(height: 10),
              if (_loading)
                const Center(child: CircularProgressIndicator())
              else if (_completed.isEmpty)
                const Empty(
                    'Hakuna ombi lililokamilika linaloweza kutathminiwa.'),
              if (_completed.isNotEmpty) ...[
                DropdownButtonFormField<String>(
                  initialValue: _consultationId,
                  decoration: const InputDecoration(
                    labelText: 'Ombi lililokamilika',
                  ),
                  items: [
                    for (final row in _completed)
                      DropdownMenuItem(
                        value: row['id'] as String,
                        child: Text(_consultationLabel(row)),
                      ),
                  ],
                  onChanged: _busy || _rating != null
                      ? null
                      : (value) => setState(() => _consultationId = value),
                ),
                const SizedBox(height: 12),
                Wrap(
                  spacing: 6,
                  children: [
                    for (var score = 1; score <= 5; score++)
                      ChoiceChip(
                        label: Text('$score'),
                        selected: _score == score,
                        onSelected: _busy || _rating != null
                            ? null
                            : (_) => setState(() => _score = score),
                      ),
                  ],
                ),
                const SizedBox(height: 10),
                TextField(
                  controller: _ratingComment,
                  maxLength: 1000,
                  enabled: !_busy && _rating == null,
                  decoration:
                      const InputDecoration(labelText: 'Maoni ya hiari'),
                ),
                FilledButton(
                  onPressed: _busy || _rating != null ? null : _submitRating,
                  child: const Text('Tuma tathmini'),
                ),
                if (_rating != null) ...[
                  const SizedBox(height: 8),
                  Panel(
                    child: Text(
                      'Tathmini imehifadhiwa. Rejea: ${_rating!['id']} · Alama: ${_rating!['score']}',
                    ),
                  ),
                ],
              ],
              const SizedBox(height: 28),
              const SectionTitle('Ripoti tukio au malalamiko'),
              const Text(
                'Ripoti itahifadhiwa kwa timu ya ubora. Hali itaonyeshwa kama ilivyorudishwa na huduma; hakuna suluhisho linalodaiwa.',
              ),
              const SizedBox(height: 10),
              DropdownButtonFormField<String>(
                initialValue: _category,
                decoration:
                    const InputDecoration(labelText: 'Muktadha wa ripoti'),
                items: [
                  for (final category in _incidentCategories)
                    DropdownMenuItem(value: category, child: Text(category)),
                ],
                onChanged: _busy
                    ? null
                    : (value) => setState(() => _category = value ?? _category),
              ),
              const SizedBox(height: 10),
              DropdownButtonFormField<String>(
                initialValue: _incidentConsultationId ?? '',
                decoration: const InputDecoration(
                  labelText: 'Ombi linalohusiana (hiari)',
                ),
                items: [
                  const DropdownMenuItem(
                      value: '', child: Text('Hakuna ombi maalum')),
                  for (final row in _completed)
                    DropdownMenuItem(
                      value: row['id'] as String,
                      child: Text(_consultationLabel(row)),
                    ),
                ],
                onChanged: _busy
                    ? null
                    : (value) =>
                        setState(() => _incidentConsultationId = value),
              ),
              const SizedBox(height: 10),
              TextField(
                controller: _incidentDescription,
                minLines: 3,
                maxLines: 6,
                maxLength: 4000,
                decoration: const InputDecoration(labelText: 'Maelezo'),
                onChanged: (_) => setState(() {}),
              ),
              CheckboxListTile(
                contentPadding: EdgeInsets.zero,
                title: const Text('Ripoti bila kutaja jina'),
                value: _anonymous,
                onChanged: _busy
                    ? null
                    : (value) => setState(() => _anonymous = value ?? false),
              ),
              FilledButton.icon(
                onPressed: _busy || _incidentDescription.text.trim().isEmpty
                    ? null
                    : _submitIncident,
                icon: const Icon(Icons.flag_outlined),
                label: const Text('Hifadhi ripoti'),
              ),
              if (_incident != null) ...[
                const SizedBox(height: 12),
                Panel(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Text('Ripoti imehifadhiwa na huduma.'),
                      Text('Rejea: ${_incident!['id']}'),
                      Text('Hali: ${_incident!['status']}'),
                      const Text(
                        'Ripoti hii inaweza kuonekana kwa Admin aliyeidhinishwa; hali baada ya kufunga ukurasa haiwezi kusomwa na mgonjwa kupitia API iliyopo.',
                      ),
                    ],
                  ),
                ),
              ],
            ],
          ),
        ),
      );

  String _consultationLabel(Map<String, dynamic> row) {
    final summary = (row['symptom_text'] as String?)?.trim();
    return summary == null || summary.isEmpty ? 'Ombi ${row['id']}' : summary;
  }
}
