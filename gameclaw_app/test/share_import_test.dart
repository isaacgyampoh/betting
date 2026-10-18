import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:gameclaw_app/features/share_import/share_import.dart';
import 'package:receive_sharing_intent/receive_sharing_intent.dart';

/// Receiving a share, in the two shapes it actually arrives in.
///
/// A share either starts the app from cold or lands while it is already open, and those are
/// different APIs. Handling one and not the other gives a feature that works half the time with
/// no pattern a user could describe, so both are tested here.
void main() {
  SharedMediaFile text(String s) =>
      SharedMediaFile(path: s, type: SharedMediaType.text, mimeType: 'text/plain');

  group('a share that starts the app', () {
    test('reads the code out of it', () async {
      ReceiveSharingIntent.setMockValues(
        initialMedia: [text('Booking code: K7F2QP on SportyBet')],
        mediaStream: const Stream.empty(),
      );
      final got = await ShareImporter().initial();

      expect(got, isNotNull);
      expect(got!.slip.confident?.code, 'K7F2QP');
      expect(got.slip.bookmaker, 'sportybet');
      expect(got.isEmpty, isFalse);
    });

    test('returns nothing when the app was opened normally', () async {
      ReceiveSharingIntent.setMockValues(initialMedia: [], mediaStream: const Stream.empty());
      expect(await ShareImporter().initial(), isNull);
    });

    test('reports an empty import rather than inventing one', () async {
      // Text arrived, but nothing in it is a booking code. That is a real outcome and the screen
      // has to say so - not claim a slip was imported.
      ReceiveSharingIntent.setMockValues(
        initialMedia: [text('Join me on the app! https://example.com')],
        mediaStream: const Stream.empty(),
      );
      final got = await ShareImporter().initial();
      expect(got, isNotNull);
      expect(got!.isEmpty, isTrue);
      expect(got.slip.confident, isNull);
    });

    test('ignores a share that is not text, because the manifest asks for none', () async {
      ReceiveSharingIntent.setMockValues(
        initialMedia: [
          SharedMediaFile(path: '/tmp/x.png', type: SharedMediaType.image, mimeType: 'image/png'),
        ],
        mediaStream: const Stream.empty(),
      );
      expect(await ShareImporter().initial(), isNull);
    });

    test('reads a caption as well as the body, since the code can be in either', () async {
      ReceiveSharingIntent.setMockValues(
        initialMedia: [
          SharedMediaFile(
            path: 'My bet today',
            message: 'Booking code: A1B2C3',
            type: SharedMediaType.text,
            mimeType: 'text/plain',
          ),
        ],
        mediaStream: const Stream.empty(),
      );
      final got = await ShareImporter().initial();
      expect(got!.slip.confident?.code, 'A1B2C3');
    });

    test('joins several shared items rather than taking only the first', () async {
      ReceiveSharingIntent.setMockValues(
        initialMedia: [text('Shared from SportyBet'), text('Booking code: K7F2QP')],
        mediaStream: const Stream.empty(),
      );
      final got = await ShareImporter().initial();
      expect(got!.slip.confident?.code, 'K7F2QP');
    });
  });

  group('a share that arrives while the app is open', () {
    test('is delivered to the listener', () async {
      final controller = StreamController<List<SharedMediaFile>>();
      ReceiveSharingIntent.setMockValues(initialMedia: [], mediaStream: controller.stream);

      final seen = <ImportedShare>[];
      final importer = ShareImporter()..listen(seen.add);
      addTearDown(() async {
        await importer.dispose();
        await controller.close();
      });

      controller.add([text('Booking code: K7F2QP')]);
      await Future<void>.delayed(Duration.zero);

      expect(seen, hasLength(1));
      expect(seen.single.slip.confident?.code, 'K7F2QP');
    });

    test('delivers each share, so a second one is not swallowed', () async {
      final controller = StreamController<List<SharedMediaFile>>();
      ReceiveSharingIntent.setMockValues(initialMedia: [], mediaStream: controller.stream);

      final seen = <ImportedShare>[];
      final importer = ShareImporter()..listen(seen.add);
      addTearDown(() async {
        await importer.dispose();
        await controller.close();
      });

      controller.add([text('Booking code: AAA111')]);
      await Future<void>.delayed(Duration.zero);
      controller.add([text('Booking code: BBB222')]);
      await Future<void>.delayed(Duration.zero);

      expect(seen.map((s) => s.slip.confident?.code).toList(), ['AAA111', 'BBB222']);
    });

    test('passes nothing on when the share holds no text', () async {
      final controller = StreamController<List<SharedMediaFile>>();
      ReceiveSharingIntent.setMockValues(initialMedia: [], mediaStream: controller.stream);

      final seen = <ImportedShare>[];
      final importer = ShareImporter()..listen(seen.add);
      addTearDown(() async {
        await importer.dispose();
        await controller.close();
      });

      controller.add([]);
      await Future<void>.delayed(Duration.zero);
      expect(seen, isEmpty);
    });

    test('stops delivering once disposed', () async {
      final controller = StreamController<List<SharedMediaFile>>();
      ReceiveSharingIntent.setMockValues(initialMedia: [], mediaStream: controller.stream);

      final seen = <ImportedShare>[];
      final importer = ShareImporter()..listen(seen.add);
      await importer.dispose();

      controller.add([text('Booking code: K7F2QP')]);
      await Future<void>.delayed(Duration.zero);
      addTearDown(controller.close);

      expect(seen, isEmpty);
    });
  });
}
