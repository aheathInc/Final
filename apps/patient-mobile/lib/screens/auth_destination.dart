import 'package:flutter/material.dart';
import '../core/session.dart';
import 'home_screen.dart';
import 'registration_screen.dart';

Future<Widget> authenticationDestination(Map<String, dynamic> data) async {
  if (data['registration_required'] == true) {
    await Session.clear();
    await Session.saveRegistration(data['registration_token'] as String);
    return RegistrationScreen(
        initial: Map<String, dynamic>.from(data['registration']));
  }
  await Session.save(
      accessToken: data['access_token'] as String,
      refreshToken: data['refresh_token'] as String,
      user: Map<String, dynamic>.from(data['user']));
  return const HomeScreen();
}
