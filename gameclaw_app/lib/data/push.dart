import 'dart:async';

import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'api_client.dart';
import 'providers.dart';

/// Native push, via Firebase Cloud Messaging.
///
/// The whole design hangs off one fact: the identifier Firebase gives us belongs to an *install*,
/// not to a sign-in. The same phone keeps the same id whoever is signed in, so the server stores
/// it uniquely and re-registering reassigns the row. That is what stops a second user on a shared
/// phone inheriting the first one's alerts, and it is why this registers on sign-in and
/// unregisters on sign-out rather than trying to hold one id per account.
///
/// Registration is event-driven because Firebase is: [FirebaseMessaging.register] asks, and the
/// id arrives later on [FirebaseMessaging.onRegistered] - which also fires on its own when the id
/// rotates after a reinstall or a restore. A rotation the server never hears about is a device
/// that silently stops receiving anything, so the stream is the source of truth, not a one-off
/// read at startup.
///
/// Nothing here assumes Firebase is configured. A build without google-services.json has no push
/// at all: every method returns quietly instead of throwing, because a missing optional feature
/// must not take the app down on launch.
class PushService {
  PushService({required this.ref});

  final Ref ref;

  FirebaseMessaging? _messaging;
  StreamSubscription<String>? _registered;
  StreamSubscription<String>? _unregistered;

  /// The id currently known to the server, so the same one is not sent twice.
  String? _sent;

  /// True once Firebase has initialised. False in a build with no Firebase configuration.
  bool get available => _messaging != null;

  /// Call once, after Firebase.initializeApp has succeeded.
  void attach(FirebaseMessaging messaging) {
    _messaging = messaging;
    _registered = messaging.onRegistered.listen(_send);
    _unregistered = messaging.onUnregistered.listen((_) => _sent = null);
  }

  Future<void> dispose() async {
    await _registered?.cancel();
    await _unregistered?.cancel();
    _registered = null;
    _unregistered = null;
  }

  /// Asks for the notification permission Android 13+ requires.
  ///
  /// Asked when the user turns alerts on, not at launch: a permission prompt on first open,
  /// before anything has been explained, is the one most people refuse for ever.
  Future<bool> requestPermission() async {
    final messaging = _messaging;
    if (messaging == null) return false;
    final settings = await messaging.requestPermission();
    return _granted(settings.authorizationStatus);
  }

  Future<bool> hasPermission() async {
    final messaging = _messaging;
    if (messaging == null) return false;
    return _granted((await messaging.getNotificationSettings()).authorizationStatus);
  }

  static bool _granted(AuthorizationStatus status) =>
      status == AuthorizationStatus.authorized || status == AuthorizationStatus.provisional;

  /// Registers this install against the signed-in user. The id arrives on [onRegistered].
  Future<void> register() async {
    final messaging = _messaging;
    if (messaging == null) return;
    if (ref.read(sessionProvider).value == null) return;
    await messaging.register();
  }

  /// Removes this device's registration, server side and at Firebase.
  ///
  /// Both halves matter. The server stops addressing this install, and unregistering at Firebase
  /// means the next person to sign in on this phone gets a fresh id rather than inheriting one.
  Future<void> unregister() async {
    final messaging = _messaging;
    final id = _sent;
    _sent = null;

    if (id != null) {
      try {
        await ref
            .read(apiClientProvider)
            .delete<Map<String, dynamic>>('/devices', body: {'token': id});
      } on ApiFailure catch (error) {
        debugPrint('push: could not unregister device (${error.message})');
      }
    }

    try {
      await messaging?.unregister();
    } on Exception {
      // Nothing useful to do. Removing it server side above is what actually stops delivery.
    }
  }

  Future<void> _send(String id) async {
    if (id == _sent) return;
    if (ref.read(sessionProvider).value == null) return;
    try {
      await ref
          .read(apiClientProvider)
          .post<Map<String, dynamic>>('/devices', body: {'token': id, 'platform': 'android'});
      _sent = id;
    } on ApiFailure catch (error) {
      // Best effort. Failing this must never block sign-in or break a screen; the next launch,
      // or the next rotation, tries again.
      debugPrint('push: could not register device (${error.message})');
    }
  }
}

final pushServiceProvider = Provider<PushService>((ref) {
  final service = PushService(ref: ref);
  ref.onDispose(service.dispose);
  return service;
});
