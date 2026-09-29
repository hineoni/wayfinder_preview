// ARCH-08: цикл внутри домена
import { b } from './bad-cycle-b'

export const a = () => b
