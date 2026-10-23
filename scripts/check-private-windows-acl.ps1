param([Parameter(Mandatory = $true)][string]$Target)
$ErrorActionPreference = 'Stop'
try {
  $identity = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
  $acl = Get-Acl -LiteralPath $Target
  $owner = $acl.GetOwner([System.Security.Principal.SecurityIdentifier]).Value
  if ($owner -ne $identity) { exit 2 }
  $allowed = @($identity, 'S-1-5-18', 'S-1-5-32-544') # current user, SYSTEM, Administrators
  $rules = $acl.GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier])
  $traverseOnly = [int][System.Security.AccessControl.FileSystemRights]::ExecuteFile -bor
                  [int][System.Security.AccessControl.FileSystemRights]::ReadAttributes -bor
                  [int][System.Security.AccessControl.FileSystemRights]::ReadPermissions -bor
                  [int][System.Security.AccessControl.FileSystemRights]::Synchronize
  foreach ($rule in $rules) {
    if ($rule.AccessControlType -eq [System.Security.AccessControl.AccessControlType]::Allow -and
        $rule.IdentityReference.Value -notin $allowed -and
        (([int]$rule.FileSystemRights -band (-bnot $traverseOnly)) -ne 0)) { exit 3 }
  }
  exit 0
} catch { exit 1 }
