; Extract rag-server.zip during install so first launch does not wait on tar.
; If this fails, piFlow.exe still extracts on first start (same path + bundle marker).

!macro NSIS_HOOK_POSTINSTALL
  DetailPrint "Extracting backend to AppData..."
  CreateDirectory "$APPDATA\piFlow"
  CreateDirectory "$APPDATA\piFlow\sidecar"
  RMDir /r "$APPDATA\piFlow\sidecar\rag-server"
  CreateDirectory "$APPDATA\piFlow\sidecar\rag-server"

  nsExec::ExecToLog '"$SYSDIR\tar.exe" -xf "$INSTDIR\rag-server.zip" -C "$APPDATA\piFlow\sidecar\rag-server"'
  Pop $0
  StrCmp $0 "0" extract_ok extract_fail

  extract_ok:
    IfFileExists "$INSTDIR\BUNDLE_INFO.json" 0 extract_done
    Delete "$APPDATA\piFlow\sidecar\.bundle-version"
    CopyFiles /SILENT "$INSTDIR\BUNDLE_INFO.json" "$APPDATA\piFlow\sidecar"
    Rename "$APPDATA\piFlow\sidecar\BUNDLE_INFO.json" "$APPDATA\piFlow\sidecar\.bundle-version"
    DetailPrint "Backend extracted."
    Goto extract_done

  extract_fail:
    DetailPrint "Backend extract deferred to first launch (tar exit $0)."
    Goto extract_done

  extract_done:
!macroend
