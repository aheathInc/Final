import 'package:flutter/material.dart';
import '../core/theme.dart';

/// Profile surfaces share a single soft, downward shadow and theme gradients.
class ProfileCard extends StatelessWidget {
  const ProfileCard(
      {super.key,
      required this.child,
      this.onTap,
      this.padding = const EdgeInsets.all(20),
      this.emphasis = false});
  final Widget child;
  final VoidCallback? onTap;
  final EdgeInsetsGeometry padding;
  final bool emphasis;
  @override
  Widget build(BuildContext context) {
    Localizations.localeOf(context);
    final p = AppPalette.of(context);
    return DecoratedBox(
      decoration:
          BoxDecoration(borderRadius: BorderRadius.circular(20), boxShadow: [
        BoxShadow(
            color: p.deepOcean.withValues(
                alpha: Theme.of(context).brightness == Brightness.dark
                    ? .28
                    : .10),
            blurRadius: 22,
            offset: const Offset(0, 9))
      ]),
      child: Material(
        color: Colors.transparent,
        borderRadius: BorderRadius.circular(20),
        clipBehavior: Clip.antiAlias,
        child: Ink(
          decoration: BoxDecoration(
              gradient: LinearGradient(
                  begin: Alignment.topLeft,
                  end: Alignment.bottomRight,
                  colors: emphasis
                      ? [p.heroMiddle, p.heroStart]
                      : [p.surface, Color.lerp(p.surface, p.mintWash, .45)!])),
          child: InkWell(
              onTap: onTap, child: Padding(padding: padding, child: child)),
        ),
      ),
    );
  }
}
