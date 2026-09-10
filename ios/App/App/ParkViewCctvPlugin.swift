import Capacitor
import Foundation
import UIKit

@objc(ParkViewCctvPlugin)
public final class ParkViewCctvPlugin: CAPPlugin, CAPBridgedPlugin, URLSessionTaskDelegate {
    public let identifier = "ParkViewCctvPlugin"
    public let jsName = "ParkViewCctv"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "connect", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "disconnect", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getStatus", returnType: CAPPluginReturnPromise)
    ]

    private var session: URLSession?
    private var snapshotURL: URL?
    private var credential: URLCredential?
    private var nextCapture: DispatchWorkItem?
    private var interval: TimeInterval = 2
    private var channel = "101"
    private var connected = false
    private var generation = 0

    @objc public func connect(_ call: CAPPluginCall) {
        guard let rawURL = call.getString("url"), !rawURL.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            call.reject("RTSP 카메라 주소를 입력해 주세요.")
            return
        }

        do {
            let connection = try Self.makeConnection(
                from: rawURL,
                httpPort: call.getInt("httpPort") ?? 80
            )
            stopCapture(notify: false)
            snapshotURL = connection.url
            credential = URLCredential(
                user: connection.username,
                password: connection.password,
                persistence: .forSession
            )
            channel = connection.channel
            interval = TimeInterval(max(1000, min(call.getInt("intervalMs") ?? 2000, 60_000))) / 1000

            let configuration = URLSessionConfiguration.ephemeral
            configuration.timeoutIntervalForRequest = 8
            configuration.timeoutIntervalForResource = 12
            configuration.requestCachePolicy = .reloadIgnoringLocalAndRemoteCacheData
            configuration.urlCache = nil
            session = URLSession(configuration: configuration, delegate: self, delegateQueue: nil)
            generation += 1
            notifyListeners("cctvState", data: ["status": "connecting", "channel": channel])
            captureFrame(initialCall: call, generation: generation)
        } catch {
            call.reject(error.localizedDescription)
        }
    }

    @objc public func disconnect(_ call: CAPPluginCall) {
        stopCapture(notify: true)
        call.resolve()
    }

    @objc public func getStatus(_ call: CAPPluginCall) {
        call.resolve([
            "connected": connected,
            "channel": channel
        ])
    }

    public func urlSession(
        _ session: URLSession,
        task: URLSessionTask,
        didReceive challenge: URLAuthenticationChallenge,
        completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void
    ) {
        let method = challenge.protectionSpace.authenticationMethod
        let supported = [
            NSURLAuthenticationMethodHTTPBasic,
            NSURLAuthenticationMethodHTTPDigest,
            NSURLAuthenticationMethodNTLM
        ]
        if supported.contains(method), let credential {
            completionHandler(.useCredential, credential)
        } else {
            completionHandler(.performDefaultHandling, nil)
        }
    }

    private func captureFrame(initialCall: CAPPluginCall?, generation expectedGeneration: Int) {
        guard expectedGeneration == generation, let session, let snapshotURL else { return }
        var request = URLRequest(url: snapshotURL)
        request.httpMethod = "GET"
        request.setValue("image/jpeg,image/png;q=0.9,*/*;q=0.1", forHTTPHeaderField: "Accept")
        request.setValue("no-cache", forHTTPHeaderField: "Cache-Control")

        session.dataTask(with: request) { [weak self] data, response, error in
            DispatchQueue.main.async {
                guard let self, expectedGeneration == self.generation else { return }
                do {
                    if let error { throw error }
                    guard let http = response as? HTTPURLResponse else {
                        throw CctvError.invalidResponse
                    }
                    guard (200...299).contains(http.statusCode) else {
                        throw CctvError.httpStatus(http.statusCode)
                    }
                    guard let data, !data.isEmpty, let frame = Self.makeFrameData(data) else {
                        throw CctvError.notAnImage
                    }

                    self.connected = true
                    self.notifyListeners("cctvState", data: ["status": "connected", "channel": self.channel])
                    self.notifyListeners("cctvFrame", data: [
                        "dataUrl": "data:image/jpeg;base64,\(frame.base64EncodedString())",
                        "capturedAt": ISO8601DateFormatter().string(from: Date()),
                        "channel": self.channel
                    ])
                    initialCall?.resolve(["connected": true, "channel": self.channel])
                    self.scheduleNextCapture(generation: expectedGeneration)
                } catch {
                    let message = Self.connectionMessage(for: error)
                    self.connected = false
                    self.notifyListeners("cctvState", data: ["status": "error", "message": message])
                    if let initialCall {
                        self.stopCapture(notify: false)
                        initialCall.reject(message)
                    } else {
                        self.scheduleNextCapture(generation: expectedGeneration)
                    }
                }
            }
        }.resume()
    }

    private func scheduleNextCapture(generation expectedGeneration: Int) {
        nextCapture?.cancel()
        let work = DispatchWorkItem { [weak self] in
            self?.captureFrame(initialCall: nil, generation: expectedGeneration)
        }
        nextCapture = work
        DispatchQueue.main.asyncAfter(deadline: .now() + interval, execute: work)
    }

    private func stopCapture(notify: Bool) {
        generation += 1
        nextCapture?.cancel()
        nextCapture = nil
        session?.invalidateAndCancel()
        session = nil
        snapshotURL = nil
        credential = nil
        connected = false
        if notify {
            notifyListeners("cctvState", data: ["status": "disconnected"])
        }
    }

    private static func makeConnection(from rawURL: String, httpPort: Int) throws -> Connection {
        guard var components = URLComponents(string: rawURL),
              let scheme = components.scheme?.lowercased(),
              ["rtsp", "rtsps", "http", "https"].contains(scheme),
              components.host != nil else {
            throw CctvError.invalidURL
        }
        let username = (components.user ?? "").removingPercentEncoding ?? components.user ?? ""
        let password = (components.password ?? "").removingPercentEncoding ?? components.password ?? ""
        guard !username.isEmpty else { throw CctvError.missingUsername }

        let channel = channelID(from: components.path)
        components.user = nil
        components.password = nil
        if scheme == "rtsp" || scheme == "rtsps" {
            components.scheme = "http"
            components.port = max(1, min(httpPort, 65_535))
            components.path = "/ISAPI/Streaming/channels/\(channel)/picture"
            components.query = nil
            components.fragment = nil
        }
        guard let url = components.url else { throw CctvError.invalidURL }
        return Connection(url: url, username: username, password: password, channel: channel)
    }

    private static func channelID(from path: String) -> String {
        let parts = path.split(separator: "/").map(String.init)
        guard let index = parts.firstIndex(where: { $0.caseInsensitiveCompare("Channels") == .orderedSame }),
              parts.indices.contains(index + 1) else {
            return "101"
        }
        let value = parts[index + 1].filter(\.isNumber)
        return value.isEmpty ? "101" : value
    }

    private static func makeFrameData(_ data: Data) -> Data? {
        guard let image = UIImage(data: data) else { return nil }
        let longestSide = max(image.size.width, image.size.height)
        guard longestSide > 1280 else { return image.jpegData(compressionQuality: 0.82) }
        let scale = 1280 / longestSide
        let size = CGSize(width: image.size.width * scale, height: image.size.height * scale)
        let renderer = UIGraphicsImageRenderer(size: size)
        let resized = renderer.image { _ in image.draw(in: CGRect(origin: .zero, size: size)) }
        return resized.jpegData(compressionQuality: 0.82)
    }

    private static func connectionMessage(for error: Error) -> String {
        if let cctvError = error as? CctvError { return cctvError.localizedDescription }
        let nsError = error as NSError
        if nsError.domain == NSURLErrorDomain {
            switch nsError.code {
            case NSURLErrorTimedOut:
                return "CCTV 응답 시간이 초과되었습니다. 같은 Wi-Fi와 IP 주소를 확인해 주세요."
            case NSURLErrorCannotConnectToHost, NSURLErrorCannotFindHost, NSURLErrorNetworkConnectionLost:
                return "CCTV에 연결할 수 없습니다. 같은 Wi-Fi와 카메라 IP를 확인해 주세요."
            default:
                break
            }
        }
        return "CCTV 연결 오류: \(error.localizedDescription)"
    }
}

public final class ParkViewBridgeViewController: CAPBridgeViewController {
    public override func capacitorDidLoad() {
        bridge?.registerPluginInstance(ParkViewCctvPlugin())
    }
}

private struct Connection {
    let url: URL
    let username: String
    let password: String
    let channel: String
}

private enum CctvError: LocalizedError {
    case invalidURL
    case missingUsername
    case invalidResponse
    case httpStatus(Int)
    case notAnImage

    var errorDescription: String? {
        switch self {
        case .invalidURL:
            return "올바른 RTSP 또는 HTTP(S) 카메라 주소를 입력해 주세요."
        case .missingUsername:
            return "카메라 주소에 사용자 이름을 포함해 주세요."
        case .invalidResponse:
            return "CCTV가 올바른 응답을 보내지 않았습니다."
        case .httpStatus(401), .httpStatus(403):
            return "CCTV 사용자 이름 또는 비밀번호가 올바르지 않습니다."
        case .httpStatus(let status):
            return "CCTV 사진 채널이 HTTP \(status)로 응답했습니다. ISAPI 스냅샷 지원 여부를 확인해 주세요."
        case .notAnImage:
            return "CCTV 응답이 사진이 아닙니다. ISAPI 스냅샷 채널을 확인해 주세요."
        }
    }
}
