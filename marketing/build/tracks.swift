import Foundation
import AVFoundation
let sem = DispatchSemaphore(value: 0)
Task {
    for p in CommandLine.arguments.dropFirst() {
        let a = AVURLAsset(url: URL(fileURLWithPath: p))
        let v = (try? await a.loadTracks(withMediaType: .video))?.count ?? 0
        let au = (try? await a.loadTracks(withMediaType: .audio))?.count ?? 0
        let d = (try? await a.load(.duration)).map { CMTimeGetSeconds($0) } ?? 0
        var sz = "?"
        if let t = (try? await a.loadTracks(withMediaType: .video))?.first,
           let n = try? await t.load(.naturalSize) { sz = "\(Int(n.width))x\(Int(n.height))" }
        print(String(format: "%-40@  %.2fs  %@  video:%d audio:%d",
                     (p as NSString).lastPathComponent as NSString, d, sz as NSString, v, au))
    }
    sem.signal()
}
sem.wait()
