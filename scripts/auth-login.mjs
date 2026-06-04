const res = await fetch('http://localhost:3000/api/auth/sign-in/email', {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    origin: 'http://localhost:3000',
    referer: 'http://localhost:3000/',
  },
  body: JSON.stringify({
    email: 'demo@axiom.space',
    password: 'demo123456',
  }),
})

console.log('status', res.status)
console.log('set-cookie', res.headers.get('set-cookie'))
console.log(await res.text())
