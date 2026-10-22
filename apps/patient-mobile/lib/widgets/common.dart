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
    final colour = tone == NoticeTone.problem ? AppColors.clay : AppColors.amber;
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.fromLTRB(14, 12, 12, 12),
      decoration: BoxDecoration(
        color: AppColors.paperSunk,
        border: Border(left: BorderSide(color: colour, width: 4)),
      ),
      child: Text(text, style: TextStyle(color: colour, fontSize: 15)),
    );
  }
}

enum NoticeTone { problem, attention }

class SectionTitle extends StatelessWidget {
  const SectionTitle(this.text, {super.key});
  final String text;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.only(bottom: 8),
        child: Text(
          text.toUpperCase(),
          style: const TextStyle(
            fontSize: 12, fontWeight: FontWeight.w600,
            letterSpacing: 0.6, color: AppColors.inkSoft,
          ),
        ),
      );
}

class Panel extends StatelessWidget {
  const Panel({super.key, required this.child, this.accent, this.onTap});
  final Widget child;
  final Color? accent;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final content = Container(
      width: double.infinity,
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Colors.white,
        border: accent != null
            ? Border(left: BorderSide(color: accent!, width: 4))
            : Border.all(color: AppColors.line),
      ),
      child: child,
    );
    if (onTap == null) return content;
    return InkWell(onTap: onTap, child: content);
  }
}

/// An empty list is usually good news here — nothing due, nothing waiting —
/// and the copy should read that way rather than as a failure.
class Empty extends StatelessWidget {
  const Empty(this.text, {super.key});
  final String text;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 40),
        child: Text(text, style: const TextStyle(color: AppColors.inkSoft, fontSize: 16)),
      );
}
