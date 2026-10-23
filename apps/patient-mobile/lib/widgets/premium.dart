import 'dart:math' as math;

import 'package:flutter/material.dart';

import '../core/theme.dart';

/// A-Health's patient-facing visual layer. These widgets present supplied
/// content and callbacks; they do not invent clinical state or API responses.
class PremiumCard extends StatefulWidget {
  const PremiumCard({
    super.key,
    required this.child,
    this.onTap,
    this.padding = const EdgeInsets.all(18),
    this.background,
  });

  final Widget child;
  final VoidCallback? onTap;
  final EdgeInsetsGeometry padding;
  final Color? background;

  @override
  State<PremiumCard> createState() => _PremiumCardState();
}

class _PremiumCardState extends State<PremiumCard> {
  bool _pressed = false;

  @override
  Widget build(BuildContext context) {
    final palette = AppPalette.of(context);
    final reduceMotion =
        MediaQuery.maybeOf(context)?.disableAnimations ?? false;
    return AnimatedScale(
      duration:
          reduceMotion ? Duration.zero : const Duration(milliseconds: 140),
      curve: Curves.easeOutCubic,
      scale: widget.onTap != null && _pressed ? .985 : 1,
      child: Material(
        color: widget.background ?? palette.surface,
        elevation: 1.5,
        shadowColor: palette.ink.withValues(alpha: .08),
        borderRadius: BorderRadius.circular(16),
        clipBehavior: Clip.antiAlias,
        child: InkWell(
          onTap: widget.onTap,
          onHighlightChanged: widget.onTap == null
              ? null
              : (pressed) => setState(() => _pressed = pressed),
          child: Padding(padding: widget.padding, child: widget.child),
        ),
      ),
    );
  }
}

/// A single restrained gradient transition, or a static version when the
/// operating system requests reduced motion.
class PremiumAuroraHero extends StatefulWidget {
  const PremiumAuroraHero({
    super.key,
    required this.child,
    this.padding = const EdgeInsets.all(24),
  });

  final Widget child;
  final EdgeInsetsGeometry padding;

  @override
  State<PremiumAuroraHero> createState() => _PremiumAuroraHeroState();
}

class _PremiumAuroraHeroState extends State<PremiumAuroraHero>
    with SingleTickerProviderStateMixin {
  late final AnimationController _animation = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 1100),
  );
  bool _reduced = false;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final reduced = MediaQuery.maybeOf(context)?.disableAnimations ?? false;
    if (reduced != _reduced) {
      _reduced = reduced;
      if (reduced) {
        _animation.stop();
        _animation.value = .55;
      } else {
        _animation.forward(from: 0);
      }
    } else if (!reduced && !_animation.isAnimating && _animation.value == 0) {
      _animation.forward();
    }
  }

  @override
  void dispose() {
    _animation.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => AnimatedBuilder(
        animation: _animation,
        child: Padding(padding: widget.padding, child: widget.child),
        builder: (context, foreground) {
          final palette = AppPalette.of(context);
          final t =
              _reduced ? .55 : Curves.easeOutCubic.transform(_animation.value);
          return Container(
            clipBehavior: Clip.antiAlias,
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(22),
              gradient: LinearGradient(
                begin: Alignment(-1 + .35 * t, -1),
                end: Alignment(1 - .18 * t, 1),
                colors: [
                  Color.lerp(palette.heroStart, palette.heroMiddle, t)!,
                  palette.heroMiddle,
                  Color.lerp(palette.heroEnd, palette.deepOcean, t)!,
                ],
              ),
              boxShadow: [
                BoxShadow(
                  color: palette.petrol.withValues(alpha: .18),
                  blurRadius: 24,
                  offset: const Offset(0, 10),
                ),
              ],
            ),
            child: Stack(
              children: [
                Positioned(
                  right: -76,
                  top: -82,
                  child: ExcludeSemantics(
                    child: Container(
                      width: 220,
                      height: 220,
                      decoration: BoxDecoration(
                        shape: BoxShape.circle,
                        border: Border.all(
                          color: Colors.white.withValues(alpha: .10),
                          width: 30,
                        ),
                      ),
                    ),
                  ),
                ),
                Positioned(
                  right: 22,
                  bottom: 12,
                  child: ExcludeSemantics(
                    child: Transform.rotate(
                      angle: math.pi / 9,
                      child: Icon(
                        Icons.favorite_outline_rounded,
                        size: 74,
                        color: Colors.white.withValues(alpha: .07),
                      ),
                    ),
                  ),
                ),
                foreground!,
              ],
            ),
          );
        },
      );
}

class PremiumHeroButton extends StatefulWidget {
  const PremiumHeroButton({
    super.key,
    required this.label,
    required this.onPressed,
    this.icon = Icons.arrow_forward_rounded,
  });

  final String label;
  final VoidCallback onPressed;
  final IconData icon;

  @override
  State<PremiumHeroButton> createState() => _PremiumHeroButtonState();
}

class _PremiumHeroButtonState extends State<PremiumHeroButton> {
  bool _pressed = false;

  @override
  Widget build(BuildContext context) {
    final palette = AppPalette.of(context);
    final reduceMotion =
        MediaQuery.maybeOf(context)?.disableAnimations ?? false;
    return AnimatedScale(
      scale: _pressed ? .98 : 1,
      duration:
          reduceMotion ? Duration.zero : const Duration(milliseconds: 130),
      child: Material(
        color: palette.surface,
        borderRadius: BorderRadius.circular(14),
        child: InkWell(
          onTap: widget.onPressed,
          onHighlightChanged: (pressed) => setState(() => _pressed = pressed),
          borderRadius: BorderRadius.circular(14),
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 14),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Flexible(
                  child: Text(
                    widget.label,
                    style: TextStyle(
                      fontSize: 16,
                      fontWeight: FontWeight.w700,
                      color: palette.petrol,
                    ),
                  ),
                ),
                const SizedBox(width: 10),
                Icon(widget.icon, color: palette.petrol, size: 20),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class PremiumSectionHeading extends StatelessWidget {
  const PremiumSectionHeading(
    this.title, {
    super.key,
    this.action,
    this.onAction,
  });

  final String title;
  final String? action;
  final VoidCallback? onAction;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.only(top: 8, bottom: 10),
        child: Row(
          children: [
            Expanded(
              child:
                  Text(title, style: Theme.of(context).textTheme.titleMedium),
            ),
            if (action != null && onAction != null)
              TextButton(onPressed: onAction, child: Text(action!)),
          ],
        ),
      );
}

class PremiumAction extends StatelessWidget {
  const PremiumAction({
    super.key,
    required this.icon,
    required this.title,
    required this.onTap,
    this.subtitle,
    this.iconColor,
    this.iconBackground,
  });

  final IconData icon;
  final String title;
  final String? subtitle;
  final VoidCallback onTap;
  final Color? iconColor;
  final Color? iconBackground;

  @override
  Widget build(BuildContext context) {
    final palette = AppPalette.of(context);
    return PremiumCard(
      onTap: onTap,
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(
            width: 46,
            height: 46,
            decoration: BoxDecoration(
              color: iconBackground ?? palette.mintWash,
              borderRadius: BorderRadius.circular(14),
            ),
            child: Icon(icon, color: iconColor ?? palette.petrol, size: 23),
          ),
          const SizedBox(height: 14),
          Text(title, style: Theme.of(context).textTheme.titleSmall),
          if (subtitle != null) ...[
            const SizedBox(height: 4),
            Text(
              subtitle!,
              style: Theme.of(context).textTheme.bodySmall,
            ),
          ],
        ],
      ),
    );
  }
}

class PremiumLinkRow extends StatelessWidget {
  const PremiumLinkRow({
    super.key,
    required this.icon,
    required this.title,
    required this.onTap,
    this.subtitle,
    this.iconColor,
  });

  final IconData icon;
  final String title;
  final String? subtitle;
  final VoidCallback onTap;
  final Color? iconColor;

  @override
  Widget build(BuildContext context) {
    final palette = AppPalette.of(context);
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: PremiumCard(
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
        onTap: onTap,
        child: Row(
          children: [
            Container(
              height: 44,
              width: 44,
              decoration: BoxDecoration(
                color: palette.mintWash,
                borderRadius: BorderRadius.circular(13),
              ),
              child: Icon(icon, color: iconColor ?? palette.petrol),
            ),
            const SizedBox(width: 13),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(title, style: Theme.of(context).textTheme.titleSmall),
                  if (subtitle != null) ...[
                    const SizedBox(height: 3),
                    Text(subtitle!,
                        style: Theme.of(context).textTheme.bodySmall),
                  ],
                ],
              ),
            ),
            const SizedBox(width: 8),
            Icon(Icons.chevron_right_rounded, color: palette.inkSoft),
          ],
        ),
      ),
    );
  }
}

class PremiumStatus extends StatelessWidget {
  const PremiumStatus(this.label, {super.key, this.urgent = false});

  final String label;
  final bool urgent;

  @override
  Widget build(BuildContext context) => Semantics(
        container: true,
        label: label,
        child: ExcludeSemantics(
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 7),
            decoration: BoxDecoration(
              color: urgent
                  ? AppPalette.of(context).urgentWash
                  : AppPalette.of(context).paperSunk,
              borderRadius: BorderRadius.circular(100),
            ),
            child: Text(
              label,
              style: TextStyle(
                fontSize: 12,
                fontWeight: FontWeight.w700,
                color: urgent
                    ? AppPalette.of(context).clay
                    : AppPalette.of(context).ink,
              ),
            ),
          ),
        ),
      );
}
