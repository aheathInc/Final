import '../core/l10n.dart';
import 'dart:async';
import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';
import '../core/api.dart';

class ResidenceField extends StatefulWidget {
  const ResidenceField(
      {super.key, required this.controller, this.enabled = true});
  final TextEditingController controller;
  final bool enabled;

  @override
  State<ResidenceField> createState() => _ResidenceFieldState();
}

class _ResidenceFieldState extends State<ResidenceField> {
  final _focus = FocusNode();
  Timer? _debounce;
  int _request = 0;
  bool _loading = false;
  String? _message;
  List<Map<String, dynamic>> _places = [];

  @override
  void initState() {
    super.initState();
    _focus.addListener(() {
      if (!_focus.hasFocus) {
        _debounce?.cancel();
        _request++;
        setState(() {
          _loading = false;
          _places = [];
          _message = null;
        });
      }
    });
  }

  @override
  void dispose() {
    _debounce?.cancel();
    _focus.dispose();
    super.dispose();
  }

  void _changed(String value) {
    _debounce?.cancel();
    final request = ++_request;
    final query = value.trim();
    setState(() {
      _places = [];
      _message = null;
      _loading = false;
    });
    if (query.length < 3 || query.length > 100) return;
    _debounce =
        Timer(const Duration(milliseconds: 650), () => _search(query, request));
  }

  Future<void> _search(String query, int request) async {
    if (!mounted || !_focus.hasFocus || !widget.enabled) return;
    setState(() => _loading = true);
    try {
      final data = await Api.registration(
          'POST', '/auth/registration/locations',
          body: {'q': query});
      if (!mounted || request != _request || !_focus.hasFocus) return;
      setState(() {
        _places = (data['places'] as List)
            .map((p) => Map<String, dynamic>.from(p as Map))
            .toList();
        _message = _places.isEmpty
            ? L.tr(
                'Hakuna eneo lililopatikana. Endelea kuandika au tumia jina uliloandika.')
            : null;
      });
    } catch (_) {
      if (!mounted || request != _request || !_focus.hasFocus) return;
      setState(() => _message = L.tr(
          'Mapendekezo hayapatikani sasa. Unaweza kuandika eneo mwenyewe.'));
    } finally {
      if (mounted && request == _request) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    Localizations.localeOf(context);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        TextFormField(
          controller: widget.controller,
          focusNode: _focus,
          enabled: widget.enabled,
          maxLength: 250,
          textCapitalization: TextCapitalization.words,
          textInputAction: TextInputAction.next,
          onChanged: _changed,
          decoration: InputDecoration(
            labelText: L.tr('Mahali unapoishi'),
            hintText: L.tr('Mfano: Dodoma'),
            counterText: '',
            helperText: L.tr('Andika angalau herufi 3 kutafuta eneo Tanzania.'),
            helperMaxLines: 2,
            suffixIcon: _loading
                ? Padding(
                    padding: EdgeInsets.all(16),
                    child: SizedBox(
                        width: 20,
                        height: 20,
                        child: CircularProgressIndicator(
                            strokeWidth: 2,
                            semanticsLabel: L.tr('Inatafuta maeneo'))))
                : const Icon(Icons.location_on_outlined),
          ),
          validator: (v) => (v ?? '').trim().length < 3
              ? L.tr('Jaza mahali unapoishi.')
              : null,
        ),
        if (_loading)
          Padding(
              padding: EdgeInsets.only(top: 8),
              child: Text(L.tr('Inatafuta maeneo...'),
                  semanticsLabel: L.tr('Inatafuta maeneo'))),
        if (_places.isNotEmpty) ...[
          const SizedBox(height: 8),
          Material(
            color: Theme.of(context).colorScheme.surface,
            shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(12),
                side: BorderSide(
                    color: Theme.of(context).colorScheme.outlineVariant)),
            clipBehavior: Clip.antiAlias,
            child: Column(children: [
              for (final place in _places)
                ListTile(
                  leading: const Icon(Icons.location_on_outlined),
                  title: Text(place['name'] as String),
                  subtitle: Text(place['context'] as String),
                  onTap: () {
                    _debounce?.cancel();
                    _request++;
                    widget.controller.text = place['label'] as String;
                    widget.controller.selection = TextSelection.collapsed(
                        offset: widget.controller.text.length);
                    setState(() {
                      _places = [];
                      _message = null;
                      _loading = false;
                    });
                    _focus.unfocus();
                  },
                )
            ]),
          ),
        ],
        if (_message != null)
          Padding(
              padding: const EdgeInsets.only(top: 8),
              child: Text(L.tr(_message!))),
        if (_message != null)
          Align(
              alignment: Alignment.centerLeft,
              child: TextButton(
                onPressed: widget.enabled
                    ? () {
                        _focus.requestFocus();
                        _changed(widget.controller.text);
                      }
                    : null,
                child: Text(L.tr('Tafuta tena')),
              )),
        const SizedBox(height: 8),
        Text(L.tr(
            'Tafuta jina la eneo; unaweza pia kuliandika mwenyewe. GPS haihitajiki.')),
        Align(
            alignment: Alignment.centerLeft,
            child: TextButton(
              onPressed: () async {
                final opened = await launchUrl(
                    Uri.parse('https://www.openstreetmap.org/copyright'),
                    mode: LaunchMode.externalApplication);
                if (!opened && context.mounted) {
                  ScaffoldMessenger.of(context).showSnackBar(SnackBar(
                      content:
                          Text(L.tr('Chanzo: openstreetmap.org/copyright'))));
                }
              },
              child: Text(L.tr('Maeneo: © OpenStreetMap contributors')),
            )),
      ],
    );
  }
}
