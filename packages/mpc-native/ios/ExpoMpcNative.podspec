Pod::Spec.new do |s|
  s.name           = 'ExpoMpcNative'
  s.version        = '0.1.0'
  s.summary        = 'Native MPC engine for Vultisig SDK'
  s.description    = 'Expo native module wrapping godkls and goschnorr frameworks for MPC operations'
  s.homepage       = 'https://github.com/vultisig/vultisig-sdk'
  s.license        = 'MIT'
  s.author         = 'Vultisig'
  s.source         = { git: 'https://github.com/vultisig/vultisig-sdk.git' }

  s.platform       = :ios, '15.1'
  s.swift_version  = '5.4'
  s.source_files   = '*.swift'

  s.vendored_frameworks = 'Frameworks/godkls.xcframework', 'Frameworks/goschnorr.xcframework'

  s.dependency 'ExpoModulesCore'
end
