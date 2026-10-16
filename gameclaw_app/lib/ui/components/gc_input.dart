import 'package:flutter/material.dart';

import '../../theme/palette.dart';
import '../../theme/tokens.dart';

/// A text field.
///
/// Filled with a hairline rather than an outline that changes colour on focus: on a dark canvas a
/// focused outline is the only lime on the screen and reads as the primary action rather than as
/// a cursor position. The lime is a 1px underline instead.
class GcTextField extends StatefulWidget {
  const GcTextField({
    super.key,
    required this.controller,
    required this.label,
    this.icon,
    this.obscure = false,
    this.keyboardType,
    this.autofillHints,
    this.textInputAction,
    this.onSubmitted,
    this.validator,
    this.enabled = true,
  });

  final TextEditingController controller;
  final String label;
  final IconData? icon;
  final bool obscure;
  final TextInputType? keyboardType;
  final Iterable<String>? autofillHints;
  final TextInputAction? textInputAction;
  final ValueChanged<String>? onSubmitted;
  final String? Function(String?)? validator;
  final bool enabled;

  @override
  State<GcTextField> createState() => _GcTextFieldState();
}

class _GcTextFieldState extends State<GcTextField> {
  late bool _hidden = widget.obscure;

  @override
  Widget build(BuildContext context) {
    return TextFormField(
      controller: widget.controller,
      enabled: widget.enabled,
      obscureText: _hidden,
      keyboardType: widget.keyboardType,
      autofillHints: widget.autofillHints,
      textInputAction: widget.textInputAction,
      onFieldSubmitted: widget.onSubmitted,
      validator: widget.validator,
      style: GcType.body.copyWith(color: gc(context).ink),
      cursorColor: gc(context).accent,
      decoration: InputDecoration(
        labelText: widget.label,
        labelStyle: GcType.body.copyWith(color: gc(context).inkMuted),
        floatingLabelStyle: GcType.label.copyWith(color: gc(context).accentInk),
        prefixIcon: widget.icon == null
            ? null
            : Icon(widget.icon, size: 18, color: gc(context).inkFaint),
        suffixIcon: widget.obscure
            ? IconButton(
                onPressed: () => setState(() => _hidden = !_hidden),
                tooltip: _hidden ? 'Show password' : 'Hide password',
                icon: Icon(
                  _hidden ? Icons.visibility_outlined : Icons.visibility_off_outlined,
                  size: 19,
                  color: gc(context).inkMuted,
                ),
              )
            : null,
        filled: true,
        fillColor: gc(context).surface,
        contentPadding: const EdgeInsets.symmetric(horizontal: GcSpace.md, vertical: GcSpace.lg),
        border: _border(gc(context).border),
        enabledBorder: _border(gc(context).border),
        focusedBorder: _border(gc(context).accent, width: 1.5),
        errorBorder: _border(gc(context).loss),
        focusedErrorBorder: _border(gc(context).loss, width: 1.5),
        errorStyle: GcType.caption.copyWith(color: gc(context).loss, fontSize: 11.5),
      ),
    );
  }

  OutlineInputBorder _border(Color colour, {double width = 1}) => OutlineInputBorder(
    borderRadius: BorderRadius.circular(GcRadius.md),
    borderSide: BorderSide(color: colour, width: width),
  );
}
