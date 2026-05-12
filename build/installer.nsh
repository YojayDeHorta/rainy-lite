!macro customUnInstallSection
Section /o "un.Eliminar datos y configuracion de usuario" SEC_DELETE_USER_DATA
  DetailPrint "Eliminando datos de usuario de ${PRODUCT_NAME}..."

  # Electron stores userData per Windows user, even when the app is installed for all users.
  ${if} $installMode == "all"
    SetShellVarContext current
  ${endif}

  RMDir /r "$APPDATA\${APP_FILENAME}"
  RMDir /r "$APPDATA\Asuka Desktop"
  !ifdef APP_PRODUCT_FILENAME
    RMDir /r "$APPDATA\${APP_PRODUCT_FILENAME}"
  !endif
  !ifdef APP_PACKAGE_NAME
    RMDir /r "$APPDATA\${APP_PACKAGE_NAME}"
  !endif

  ${if} $installMode == "all"
    SetShellVarContext all
  ${endif}
SectionEnd
!macroend
