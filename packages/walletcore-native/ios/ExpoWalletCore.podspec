Pod::Spec.new do |s|
  s.name           = 'ExpoWalletCore'
  s.version        = '0.1.0'
  s.summary        = 'Native WalletCore bridge for Vultisig SDK'
  s.description    = 'Expo native module wrapping TrustWallet WalletCore for chain operations'
  s.homepage       = 'https://github.com/vultisig/vultisig-sdk'
  s.license        = 'MIT'
  s.author         = 'Vultisig'
  s.source         = { git: 'https://github.com/vultisig/vultisig-sdk.git' }

  s.platform       = :ios, '15.1'
  s.swift_version  = '5.4'
  s.source_files   = '*.swift'

  s.dependency 'ExpoModulesCore'
  s.dependency 'TrustWalletCore', '4.3.22'
end
