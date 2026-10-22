import sys
src, out = sys.argv[1], sys.argv[2]
s = open(src, encoding='utf-8').read()
i = s.index('</style>\n') + len('</style>\n')
head = '<!doctype html>\n<html lang="de">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n'
open(out, 'w', encoding='utf-8').write(head + s[:i] + '</head>\n<body>\n' + s[i:].lstrip('\n') + '</body>\n</html>\n')
