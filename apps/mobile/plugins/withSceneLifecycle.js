// Opstart via UIScene (SceneDelegate) i stedet for kun AppDelegate.
//
// iOS 27 lukker en app ved start, hvis den er bygget med iOS 27-SDK'et og
// ikke bruger scene-livscyklussen (UIKit: "NoSceneLifecycleAdoption", maalt
// 04-10-2026 i iPhone 18 Pro-simulatoren). Expo SDK 54's skabelon opretter
// vinduet i AppDelegate, saa vi flytter det til en SceneDelegate her.
//
// Under scener kalder iOS ikke laengere AppDelegates open-url/universal-link/
// livscyklus-metoder, saa SceneDelegate sender dem videre dertil. Paa den
// maade virker Google-login, links ind i appen og Expo-modulernes lyttere
// uaendret.
const { withInfoPlist, withAppDelegate } = require('expo/config-plugins');

const WINDOW_BLOCK = /#if os\(iOS\) \|\| os\(tvOS\)\s*\n\s*window = UIWindow\(frame: UIScreen\.main\.bounds\)[\s\S]*?#endif\n/;

const SCENE_DELEGATE = `
// Tilfoejet af plugins/withSceneLifecycle.js
class SceneDelegate: UIResponder, UIWindowSceneDelegate {
  var window: UIWindow?

  private var appDelegate: AppDelegate? {
    UIApplication.shared.delegate as? AppDelegate
  }

  func scene(
    _ scene: UIScene,
    willConnectTo session: UISceneSession,
    options connectionOptions: UIScene.ConnectionOptions
  ) {
    guard let windowScene = scene as? UIWindowScene, let appDelegate else { return }

    // Kold start fra et link: React Natives Linking.getInitialURL() laeser
    // launchOptions, saa de bygges ud fra scenens connectionOptions.
    var launchOptions: [UIApplication.LaunchOptionsKey: Any] = [:]
    if let url = connectionOptions.urlContexts.first?.url {
      launchOptions[.url] = url
    } else if let activity = connectionOptions.userActivities.first(where: {
      $0.activityType == NSUserActivityTypeBrowsingWeb
    }) {
      launchOptions[.userActivityDictionary] = [
        UIApplication.LaunchOptionsKey.userActivityType.rawValue: activity.activityType,
        "UIApplicationLaunchOptionsUserActivityKey": activity,
      ] as [String: Any]
    }

    let window = UIWindow(windowScene: windowScene)
    self.window = window
    appDelegate.window = window
    appDelegate.reactNativeFactory?.startReactNative(
      withModuleName: "main",
      in: window,
      launchOptions: launchOptions)
  }

  func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
    for context in URLContexts {
      var options: [UIApplication.OpenURLOptionsKey: Any] = [
        .openInPlace: context.options.openInPlace
      ]
      if let source = context.options.sourceApplication {
        options[.sourceApplication] = source
      }
      if let annotation = context.options.annotation {
        options[.annotation] = annotation
      }
      _ = appDelegate?.application(UIApplication.shared, open: context.url, options: options)
    }
  }

  func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
    _ = appDelegate?.application(
      UIApplication.shared, continue: userActivity, restorationHandler: { _ in })
  }

  func sceneDidBecomeActive(_ scene: UIScene) {
    appDelegate?.applicationDidBecomeActive(UIApplication.shared)
  }

  func sceneWillResignActive(_ scene: UIScene) {
    appDelegate?.applicationWillResignActive(UIApplication.shared)
  }

  func sceneDidEnterBackground(_ scene: UIScene) {
    appDelegate?.applicationDidEnterBackground(UIApplication.shared)
  }

  func sceneWillEnterForeground(_ scene: UIScene) {
    appDelegate?.applicationWillEnterForeground(UIApplication.shared)
  }
}
`;

function withSceneLifecycle(config) {
  config = withInfoPlist(config, (cfg) => {
    cfg.modResults.UIApplicationSceneManifest = {
      UIApplicationSupportsMultipleScenes: false,
      UISceneConfigurations: {
        UIWindowSceneSessionRoleApplication: [
          {
            UISceneConfigurationName: 'Default Configuration',
            UISceneDelegateClassName: '$(PRODUCT_MODULE_NAME).SceneDelegate',
          },
        ],
      },
    };
    return cfg;
  });

  return withAppDelegate(config, (cfg) => {
    if (cfg.modResults.language !== 'swift') {
      throw new Error('withSceneLifecycle: forventer en Swift-AppDelegate');
    }
    let src = cfg.modResults.contents;
    if (src.includes('class SceneDelegate')) {
      return cfg;
    }
    // Fejl hoejt hvis skabelonen har aendret sig (fx ved Expo-opgradering) -
    // ellers ville appen starte med to vinduer eller slet ingen.
    if (!WINDOW_BLOCK.test(src)) {
      throw new Error(
        'withSceneLifecycle: fandt ikke vindues-opstarten i AppDelegate.swift. ' +
          'Expo-skabelonen er aendret - tilpas pluginet (eller fjern det, hvis Expo nu selv bruger scener).'
      );
    }
    src = src.replace(WINDOW_BLOCK, '');
    cfg.modResults.contents = src.trimEnd() + '\n' + SCENE_DELEGATE;
    return cfg;
  });
}

module.exports = withSceneLifecycle;
