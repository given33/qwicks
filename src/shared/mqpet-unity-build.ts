export const MQPET_UNITY_WEBGL_ENV = 'QWICKS_MQPET_UNITY_WEBGL_DIR';

export const MQPET_UNITY_BUILD_DIR = 'Build';
export const MQPET_UNITY_DEFAULT_BUILD_STEM = 'QQPet';

export const REQUIRED_MQPET_UNITY_BUILD_EXTENSIONS = [
  'loader.js',
  'framework.js',
  'wasm',
  'data',
] as const;

export type MqpetUnityBuildFileExtension = typeof REQUIRED_MQPET_UNITY_BUILD_EXTENSIONS[number];
export type MqpetUnityBuildFile = `${typeof MQPET_UNITY_BUILD_DIR}/${string}.${MqpetUnityBuildFileExtension}`;

export const REQUIRED_MQPET_UNITY_BUILD_FILES = [
  'Build/QQPet.loader.js',
  'Build/QQPet.framework.js',
  'Build/QQPet.wasm',
  'Build/QQPet.data',
] as const satisfies readonly MqpetUnityBuildFile[];

export type MqpetUnityBuildStatus =
  | {
    available: true;
    root: string;
    buildBaseUrl: string;
    loaderUrl: string;
    dataUrl: string;
    frameworkUrl: string;
    codeUrl: string;
    streamingAssetsUrl: string;
  }
  | {
    available: false;
    root: string;
    reason: 'missing-files';
    missingFiles: MqpetUnityBuildFile[];
  }
  | {
    available: false;
    root: string;
    reason: 'ambiguous-loader';
    loaderFiles: MqpetUnityBuildFile[];
  };
