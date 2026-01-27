!macro customInstall
  ; Define unique ProgID for your browser
  WriteRegStr HKLM "SOFTWARE\Classes\DiscoveryBrowser.HTML" "" "Discovery HTML Document"
  WriteRegStr HKLM "SOFTWARE\Classes\DiscoveryBrowser.HTML\DefaultIcon" "" "$INSTDIR\Discovery Browser.exe,0"
  WriteRegStr HKLM "SOFTWARE\Classes\DiscoveryBrowser.HTML\shell\open\command" "" '"$INSTDIR\Discovery Browser.exe" "%1"'

  ; Register under StartMenuInternet (The "Web Browser" category)
  WriteRegStr HKLM "SOFTWARE\Clients\StartMenuInternet\DiscoveryBrowser" "" "Discovery Browser"
  WriteRegStr HKLM "SOFTWARE\Clients\StartMenuInternet\DiscoveryBrowser\Capabilities" "ApplicationName" "Discovery Browser"
  WriteRegStr HKLM "SOFTWARE\Clients\StartMenuInternet\DiscoveryBrowser\Capabilities" "ApplicationDescription" "A beautiful card-style web browser."
  WriteRegStr HKLM "SOFTWARE\Clients\StartMenuInternet\DiscoveryBrowser\Capabilities" "ApplicationIcon" "$INSTDIR\Discovery Browser.exe,0"
  
  ; Associate Protocols and File Types in Capabilities
  WriteRegStr HKLM "SOFTWARE\Clients\StartMenuInternet\DiscoveryBrowser\Capabilities\URLAssociations" "http" "DiscoveryBrowser.HTML"
  WriteRegStr HKLM "SOFTWARE\Clients\StartMenuInternet\DiscoveryBrowser\Capabilities\URLAssociations" "https" "DiscoveryBrowser.HTML"
  WriteRegStr HKLM "SOFTWARE\Clients\StartMenuInternet\DiscoveryBrowser\Capabilities\FileAssociations" ".htm" "DiscoveryBrowser.HTML"
  WriteRegStr HKLM "SOFTWARE\Clients\StartMenuInternet\DiscoveryBrowser\Capabilities\FileAssociations" ".html" "DiscoveryBrowser.HTML"

  ; IMPORTANT: Register with Windows RegisteredApplications
  WriteRegStr HKLM "SOFTWARE\RegisteredApplications" "DiscoveryBrowser" "SOFTWARE\Clients\StartMenuInternet\DiscoveryBrowser\Capabilities"
  
  ; Install Info for re-registration
  WriteRegStr HKLM "SOFTWARE\Clients\StartMenuInternet\DiscoveryBrowser\InstallInfo" "ReinstallCommand" '"$INSTDIR\Discovery Browser.exe" --set-default-browser'
  WriteRegStr HKLM "SOFTWARE\Clients\StartMenuInternet\DiscoveryBrowser\InstallInfo" "HideIconsCommand" '"$INSTDIR\Discovery Browser.exe" --hide-icons'
  WriteRegStr HKLM "SOFTWARE\Clients\StartMenuInternet\DiscoveryBrowser\InstallInfo" "ShowIconsCommand" '"$INSTDIR\Discovery Browser.exe" --show-icons'
  WriteRegStr HKLM "SOFTWARE\Clients\StartMenuInternet\DiscoveryBrowser\InstallInfo" "IconsVisible" 1
!macroend

!macro customUnInstall
  DeleteRegKey HKLM "SOFTWARE\Clients\StartMenuInternet\DiscoveryBrowser"
  DeleteRegValue HKLM "SOFTWARE\RegisteredApplications" "DiscoveryBrowser"
  DeleteRegKey HKLM "SOFTWARE\Classes\DiscoveryBrowser.HTML"
!macroend