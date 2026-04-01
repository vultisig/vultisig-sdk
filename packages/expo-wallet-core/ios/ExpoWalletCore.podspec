Pod::Spec.new do |s|
  s.name           = 'ExpoWalletCore'
  s.version        = '0.1.0'
  s.summary        = 'Vultisig WalletCore Expo module'
  s.description    = 'Expo native module wrapping TrustWallet wallet-core for React Native'
  s.author         = 'Vultisig'
  s.homepage       = 'https://github.com/vultisig/vultisig-sdk'
  s.platforms      = { :ios => '15.1' }
  s.source         = { git: '' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.dependency 'TrustWalletCore'
  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES' }
  s.source_files = "*.{h,m,mm,swift,hpp,cpp}"
end
