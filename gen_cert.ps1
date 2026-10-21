$cert = New-SelfSignedCertificate -DnsName "localhost", "163.19.131.70" -CertStoreLocation "cert:\CurrentUser\My" -NotAfter (Get-Date).AddYears(2)
$pwd = ConvertTo-SecureString -String "1234" -Force -AsPlainText
Export-PfxCertificate -Cert $cert -FilePath "$PSScriptRoot\cert.pfx" -Password $pwd
Write-Host "cert.pfx created successfully"
