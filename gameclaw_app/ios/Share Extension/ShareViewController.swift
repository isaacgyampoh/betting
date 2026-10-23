//
//  ShareViewController.swift
//  Share Extension
//
//  The iOS half of "share a slip into GameClaw". The Android app has carried this since the
//  ACTION_SEND intent filter went in; on iOS the same job needs a separate process, because an
//  extension is its own target with its own bundle and its own sandbox.
//
//  All the work is in RSIShareViewController, from receive_sharing_intent. It writes what was
//  shared into the App Group container and opens the host app, which is what makes a cold start
//  work: the app may not be running when the user shares, and the shared text has to survive
//  until it launches.
//

import receive_sharing_intent

class ShareViewController: RSIShareViewController {

    /// Straight into the app, with no compose sheet on the way.
    ///
    /// The plugin's own example returns false, which shows a caption field and a Send button.
    /// That is right for sharing a photo with a message attached. What arrives here is a booking
    /// code someone has just copied out of a bookmaker's app, and asking them to write a caption
    /// for it adds a step to the one flow that is supposed to be faster than retyping the code.
    ///
    /// Android does the same thing: its ACTION_SEND filter hands the text to the app directly.
    override func shouldAutoRedirect() -> Bool {
        return true
    }
}
