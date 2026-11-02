import '../core/l10n.dart';
import 'package:flutter/material.dart';
import '../core/theme.dart';

/// The only widget that carries amber or clay. If a screen shows one, it is
/// telling the reader that something needs them.
class Notice extends StatelessWidget {
  const Notice(this.text, {super.key, this.tone = NoticeTone.problem});
  final String text;
  final NoticeTone tone;

  @override
  Widget build(BuildContext context) {
    Localizations.localeOf(context);
    final palette = AppPalette.of(context);
    final colour = tone == NoticeTone.problem ? palette.clay : palette.amber;
    final icon = tone == NoticeTone.problem
        ? Icons.error_outline_rounded
        : Icons.info_outline_rounded;
    return Semantics(
      container: true,
      liveRegion: true,
      label: L.tr(text),
      child: Container(
        width: double.infinity,
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(
          color: palette.paperSunk,
          borderRadius: BorderRadius.circular(14),
          border: Border.all(color: colour.withValues(alpha: .35)),
        ),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Icon(icon, color: colour, size: 21),
            const SizedBox(width: 10),
            Expanded(
              child: Text(
                L.tr(text),
                style: TextStyle(color: palette.ink, fontSize: 15),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

enum NoticeTone { problem, attention }

class SectionTitle extends StatelessWidget {
  const SectionTitle(this.text, {super.key});
  final String text;

  @override
  Widget build(BuildContext context) {
    Localizations.localeOf(context);
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: Text(
        L.tr(text),
        style: Theme.of(context).textTheme.titleMedium,
      ),
    );
  }
}

class Panel extends StatelessWidget {
  const Panel({super.key, required this.child, this.accent, this.onTap});
  final Widget child;
  final Color? accent;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    Localizations.localeOf(context);
    final palette = AppPalette.of(context);
    final content = Container(
      width: double.infinity,
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: palette.surface,
        borderRadius: BorderRadius.circular(16),
        border: accent != null
            ? Border(left: BorderSide(color: accent!, width: 4))
            : Border.all(color: palette.line),
      ),
      child: child,
    );
    if (onTap == null) return content;
    return ClipRRect(
      borderRadius: BorderRadius.circular(16),
      child: Material(
        color: Colors.transparent,
        child: InkWell(onTap: onTap, child: content),
      ),
    );
  }
}

/// An empty list is usually good news here — nothing due, nothing waiting —
/// and the copy should read that way rather than as a failure.
class Empty extends StatelessWidget {
  const Empty(this.text, {super.key});
  final String text;

  @override
  Widget build(BuildContext context) {
    Localizations.localeOf(context);
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 40),
      child: Text(
        L.tr(text),
        textAlign: TextAlign.center,
        style: TextStyle(color: AppPalette.of(context).inkSoft, fontSize: 16),
      ),
    );
  }
}
