Pod::Spec.new do |s|
  s.name           = 'ExpoMpc'
  s.version        = '0.1.0'
  s.summary        = 'Vultisig MPC signing (DKLS + Schnorr) Expo module'
  s.description    = 'Expo native module wrapping godkls and goschnorr xcframeworks for threshold signing'
  s.author         = 'Vultisig'
  s.homepage       = 'https://github.com/vultisig/vultisig-sdk'
  s.platforms      = {
    :ios => '15.1',
  }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
  }

  s.source_files = "*.{h,m,mm,swift,hpp,cpp}"
  s.vendored_frameworks = "Frameworks/godkls.xcframework", "Frameworks/goschnorr.xcframework"
end
