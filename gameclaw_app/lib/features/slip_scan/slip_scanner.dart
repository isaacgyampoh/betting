import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:google_mlkit_text_recognition/google_mlkit_text_recognition.dart';
import 'package:image_picker/image_picker.dart';

import 'slip_parser.dart';

/// Getting a picture of a slip, and the words out of it.
///
/// Recognition is on-device, through ML Kit. Nothing leaves the phone: no upload, no vision API,
/// no bill per image, and a photograph of somebody's betting slip never reaches a server at all.
/// That last part is the reason to prefer it even where a hosted model would read a blurry
/// picture better.
class SlipScanner {
  SlipScanner({ImagePicker? picker, TextRecognizer? recognizer})
    : _picker = picker ?? ImagePicker(),
      _recognizer = recognizer ?? TextRecognizer(script: TextRecognitionScript.latin);

  final ImagePicker _picker;
  final TextRecognizer _recognizer;

  /// Long edge in pixels. A slip is text on a flat background, and recognition gains nothing from
  /// a 12-megapixel original while the resize saves memory on a cheap phone and keeps the whole
  /// operation off the edge of an OutOfMemory.
  static const _maxEdge = 2000.0;

  /// The camera, or null if the user backed out.
  Future<XFile?> capture() => _picker.pickImage(
    source: ImageSource.camera,
    maxWidth: _maxEdge,
    maxHeight: _maxEdge,
    imageQuality: 92,
  );

  /// The gallery, or null if the user backed out.
  Future<XFile?> pick() => _picker.pickImage(
    source: ImageSource.gallery,
    maxWidth: _maxEdge,
    maxHeight: _maxEdge,
    imageQuality: 92,
  );

  /// Reads a slip out of an image file.
  ///
  /// Returns null when recognition itself fails - a corrupt file, an unreadable format. An image
  /// that is simply not a betting slip is not a failure: it parses to an empty slip, and the
  /// caller tells the user nothing was found rather than that something went wrong.
  Future<ParsedSlip?> read(String path) async {
    try {
      final input = InputImage.fromFilePath(path);
      final recognised = await _recognizer.processImage(input);
      return parseSlip(layoutAwareText(recognised));
    } catch (error) {
      debugPrint('slip scan: could not read image ($error)');
      return null;
    }
  }

  /// Releases the native recogniser.
  ///
  /// ML Kit holds a native object per recogniser, and leaking one leaks off-heap memory that the
  /// Dart GC cannot reach. Every caller that builds a scanner has to close it.
  Future<void> dispose() => _recognizer.close();
}

/// Rebuilds the text in the order a person reads it, using where the words actually are.
///
/// `RecognizedText.text` is grouped by block, and a slip puts its prices in a right-hand column.
/// ML Kit treats that column as its own block, so the plain text reads every fixture and market
/// first and then every price afterwards - at which point the last selection collects the first
/// selection's odds. Measured on a real slip: Bournemouth and Osasuna came back with no price at
/// all and Udinese was given 1.85, which belonged to Bournemouth. Each row looked entirely
/// plausible on screen.
///
/// Sorting lines by vertical position and joining those that share a horizontal band puts the
/// price back on the row it was printed on.
String layoutAwareText(RecognizedText recognised) {
  final lines = <({int top, int left, String text})>[];
  for (final block in recognised.blocks) {
    for (final line in block.lines) {
      final box = line.boundingBox;
      lines.add((top: box.top.round(), left: box.left.round(), text: line.text));
    }
  }
  if (lines.isEmpty) return recognised.text;

  lines.sort((a, b) => a.top != b.top ? a.top.compareTo(b.top) : a.left.compareTo(b.left));

  // A band proportional to the text itself, so this works at any resolution: lines closer than
  // roughly half a typical line height belong to the same visual row.
  final heights = <int>[];
  for (var i = 1; i < lines.length; i++) {
    final gap = lines[i].top - lines[i - 1].top;
    if (gap > 0) heights.add(gap);
  }
  heights.sort();
  final typical = heights.isEmpty ? 24 : heights[heights.length ~/ 2];
  final band = (typical * 0.6).round().clamp(6, 60);

  final rows = <List<({int top, int left, String text})>>[];
  for (final line in lines) {
    if (rows.isNotEmpty && (line.top - rows.last.first.top).abs() <= band) {
      rows.last.add(line);
    } else {
      rows.add([line]);
    }
  }

  return rows
      .map((row) => (row..sort((a, b) => a.left.compareTo(b.left))).map((l) => l.text).join('  '))
      .join('\n');
}

/// Removes a temporary image once it is no longer needed.
///
/// The picker copies what the user chose into the app's cache, so an abandoned scan leaves a
/// full-size photograph of somebody's betting slip on disk. Best effort: a file that cannot be
/// deleted is not worth an error, but it is worth trying every time.
Future<void> discardImage(String? path) async {
  if (path == null) return;
  try {
    final file = File(path);
    if (await file.exists()) await file.delete();
  } catch (_) {
    // Nothing useful to do, and nothing the user can act on.
  }
}
