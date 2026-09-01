import { Capacitor } from "@capacitor/core";
import { Geolocation } from "@capacitor/geolocation";
import { SpeechRecognition } from "@capgo/capacitor-speech-recognition";
import { AndroidSettings, IOSSettings, NativeSettings } from "capacitor-native-settings";

function permissionGranted(status, keys) {
  return keys.some((key) => status?.[key] === "granted");
}

function permissionError(kind) {
  const error = new Error(`${kind} 권한이 허용되지 않았습니다.`);
  error.name = "NotAllowedError";
  error.code = "PERMISSION_DENIED";
  return error;
}

async function openAppSettings() {
  const result = await NativeSettings.open({
    optionAndroid: AndroidSettings.ApplicationDetails,
    optionIOS: IOSSettings.App
  });
  return result.status;
}

async function checkLocationPermission() {
  if (!Capacitor.isNativePlatform()) return "web";
  const status = await Geolocation.checkPermissions();
  if (permissionGranted(status, ["location", "coarseLocation"])) return "granted";
  return status.location || status.coarseLocation || "prompt";
}

async function getCurrentPosition(options = {}) {
  const status = await Geolocation.requestPermissions({ permissions: ["location"] });
  if (!permissionGranted(status, ["location", "coarseLocation"])) {
    throw permissionError("위치");
  }
  const position = await Geolocation.getCurrentPosition({
    enableHighAccuracy: true,
    timeout: 20000,
    maximumAge: 30000,
    ...options
  });
  return {
    latitude: position.coords.latitude,
    longitude: position.coords.longitude,
    accuracy: position.coords.accuracy
  };
}

async function checkSpeechPermission() {
  if (!Capacitor.isNativePlatform()) return "web";
  const status = await SpeechRecognition.checkPermissions();
  return status.speechRecognition || "prompt";
}

async function recognizeSpeech() {
  const available = await SpeechRecognition.available();
  if (!available.available) {
    throw new Error("이 기기에서는 음성 인식을 사용할 수 없습니다.");
  }
  const status = await SpeechRecognition.requestPermissions();
  if (!permissionGranted(status, ["speechRecognition"])) {
    throw permissionError("마이크와 음성 인식");
  }
  const onDevice = await SpeechRecognition.isOnDeviceRecognitionAvailable({
    language: "ko-KR"
  }).catch(() => ({ available: false }));
  const result = await SpeechRecognition.start({
    language: "ko-KR",
    maxResults: 3,
    partialResults: false,
    popup: false,
    addPunctuation: false,
    useOnDeviceRecognition: onDevice.available,
    contextualStrings: ["주차장", "공영주차장", "역", "백화점", "병원"]
  });
  return String(result.matches?.[0] || "").trim();
}

window.ParkViewNative = Object.freeze({
  isNative: Capacitor.isNativePlatform(),
  platform: Capacitor.getPlatform(),
  checkLocationPermission,
  getCurrentPosition,
  checkSpeechPermission,
  recognizeSpeech,
  openAppSettings
});
