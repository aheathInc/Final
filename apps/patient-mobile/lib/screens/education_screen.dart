import 'package:flutter/material.dart';

import '../core/api.dart';
import '../core/patient_experience.dart';
import '../core/theme.dart';
import '../widgets/common.dart';

class EducationScreen extends StatefulWidget {
  const EducationScreen({super.key, this.onDiagnostic});

  @visibleForTesting
  final void Function(String event, {int? status, String? errorType})?
      onDiagnostic;
  @override
  State<EducationScreen> createState() => _EducationScreenState();
}

class _EducationScreenState extends State<EducationScreen> {
  List<Map<String, dynamic>> _articles = [];
  Map<String, Map<String, dynamic>> _topics = {};
  String? _error;
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    widget.onDiagnostic?.call('REQUEST_STARTED');
    try {
      final values = await Future.wait([
        Api.get('/education/articles', query: {'limit': 100}),
        Api.get('/education/topics'),
      ]);
      widget.onDiagnostic?.call('BODY_DECODED');
      final articles = educationArticlesFromJson(values[0]);
      final topics = educationTopicsFromJson(values[1]);
      widget.onDiagnostic?.call('MODEL_PARSED');
      if (!mounted) return;
      setState(() {
        _articles = articles;
        _topics = {
          for (final topic in topics) topic['slug'] as String: topic,
        };
        _error = null;
        _loading = false;
      });
      widget.onDiagnostic?.call('STATE_SUCCESS');
    } catch (error) {
      widget.onDiagnostic?.call(
        'STATE_ERROR',
        status: error is ApiException ? error.status : null,
        errorType: error.runtimeType.toString(),
      );
      if (mounted) {
        setState(() {
          _error = 'Makala za elimu hazikuweza kupakiwa.';
          _loading = false;
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(title: const Text('Elimu ya afya')),
        body: _loading
            ? const Center(child: CircularProgressIndicator())
            : RefreshIndicator(
                onRefresh: _load,
                child: ListView(
                  padding: const EdgeInsets.all(20),
                  children: [
                    const Text(
                      'Makala yaliyochapishwa na kukaguliwa. Maudhui yanaonyeshwa katika lugha iliyohifadhiwa.',
                    ),
                    if (_error != null) ...[
                      const SizedBox(height: 12),
                      Notice(_error!),
                    ],
                    if (_error == null && _articles.isEmpty)
                      const Padding(
                        padding: EdgeInsets.only(top: 20),
                        child: Empty('Hakuna makala zilizochapishwa kwa sasa.'),
                      ),
                    ..._articles.map((article) {
                      final topic = _topics[article['topic_slug']];
                      final category = topic?['category'] as String? ??
                          article['topic_slug'] as String? ??
                          'Elimu ya afya';
                      return Padding(
                        padding: const EdgeInsets.only(top: 12),
                        child: Panel(
                          onTap: () => Navigator.of(context).push(
                            MaterialPageRoute(
                              builder: (_) => EducationArticleScreen(
                                slug: article['slug'] as String,
                                language: article['language'] as String?,
                                category: category,
                              ),
                            ),
                          ),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Row(
                                children: [
                                  Expanded(
                                    child: Text(
                                      article['title'] as String,
                                      style: const TextStyle(
                                        fontSize: 17,
                                        fontWeight: FontWeight.w600,
                                      ),
                                    ),
                                  ),
                                  const Icon(
                                    Icons.chevron_right,
                                    color: AppColors.inkSoft,
                                  ),
                                ],
                              ),
                              const SizedBox(height: 5),
                              Text(article['summary'] as String),
                              const SizedBox(height: 8),
                              Text(
                                '$category  |  ${article['language'] ?? 'lugha haijatajwa'}  |  Imechapishwa',
                                style:
                                    const TextStyle(color: AppColors.inkSoft),
                              ),
                            ],
                          ),
                        ),
                      );
                    }),
                  ],
                ),
              ),
      );
}

class EducationArticleScreen extends StatefulWidget {
  const EducationArticleScreen({
    required this.slug,
    required this.language,
    required this.category,
    super.key,
  });

  final String slug;
  final String? language;
  final String category;

  @override
  State<EducationArticleScreen> createState() => _EducationArticleScreenState();
}

class _EducationArticleScreenState extends State<EducationArticleScreen> {
  Map<String, dynamic>? _article;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final response = await Api.get(
        '/education/articles/${widget.slug}',
        query: {if (widget.language != null) 'language': widget.language},
      );
      if (mounted) {
        setState(() {
          _article = educationArticleFromJson(response);
          _error = null;
        });
      }
    } catch (_) {
      if (mounted) setState(() => _error = 'Makala hii haipatikani sasa.');
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(title: const Text('Makala ya afya')),
        body: _article == null
            ? Center(
                child: _error == null
                    ? const CircularProgressIndicator()
                    : Notice(_error!),
              )
            : ListView(
                padding: const EdgeInsets.all(20),
                children: [
                  Text(
                    widget.category,
                    style: const TextStyle(color: AppColors.petrol),
                  ),
                  const SizedBox(height: 8),
                  Text(
                    _article!['title'] as String,
                    style: const TextStyle(
                      fontSize: 23,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                  const SizedBox(height: 8),
                  Text('Lugha: ${_article!['language'] ?? 'haijatajwa'}'),
                  const SizedBox(height: 12),
                  Text(
                    _article!['summary'] as String? ?? '',
                    style: const TextStyle(fontWeight: FontWeight.w500),
                  ),
                  const SizedBox(height: 16),
                  Text(
                    _article!['body'] as String? ??
                        _article!['summary'] as String? ??
                        '',
                    style: const TextStyle(fontSize: 16, height: 1.5),
                  ),
                  const SizedBox(height: 16),
                  const Text('Hali: imechapishwa'),
                ],
              ),
      );
}
