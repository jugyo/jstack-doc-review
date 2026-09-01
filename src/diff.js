export function unifiedDiff(oldText, newText, oldLabel="previous", newLabel="current") {
  const a=oldText.split("\n"), b=newText.split("\n"), n=a.length,m=b.length;
  const dp=Array.from({length:n+1},()=>new Uint32Array(m+1));
  for(let i=n-1;i>=0;i--)for(let j=m-1;j>=0;j--)dp[i][j]=a[i]===b[j]?dp[i+1][j+1]+1:Math.max(dp[i+1][j],dp[i][j+1]);
  const out=[`--- ${oldLabel}`,`+++ ${newLabel}`,"@@"];
  let i=0,j=0;
  while(i<n||j<m){if(i<n&&j<m&&a[i]===b[j]){out.push(" "+a[i]);i++;j++;}else if(j<m&&(i===n||dp[i][j+1]>=dp[i+1][j])){out.push("+"+b[j++]);}else{out.push("-"+a[i++]);}}
  return out.join("\n");
}
