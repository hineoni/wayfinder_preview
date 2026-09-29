import { describe, expect, it } from 'vitest'
import { CsvFormatError, parseControlCsv, parseSyntheticCsv } from '../src/raw'

const syntheticHeader =
  'Заявка;Тип заявки BK;Тип заявки HD;Начало;Окончание;Район;Адрес;Подключение;Гигабитное подключение'
const syntheticRow =
  '74198;Подключение;Конвергенция абонента;17.08.2026 20:00;17.08.2026 22:00;Кузьминки;Город Москва, пр-кт.Волгоградский, д. 128 к 5;FMC;Нет'
const officeTail = ';;;;;;;;\n;;;;;;;;\nАдрес Офиса;г. Москва, ул Юных Ленинцев, д 83с 4;;;;;;;\n'

describe('parseSyntheticCsv', () => {
  it('читает заявки и офис, приводит типы', () => {
    const file = parseSyntheticCsv(`${syntheticHeader}\n${syntheticRow}\n${officeTail}`, 'east.csv')
    expect(file.office).toBe('г. Москва, ул Юных Ленинцев, д 83с 4')
    expect(file.records).toEqual([
      {
        id: '74198',
        bkType: 'Подключение',
        hdType: 'Конвергенция абонента',
        start: { day: '2026-08-17', minute: 1200 },
        end: { day: '2026-08-17', minute: 1320 },
        district: 'Кузьминки',
        address: 'Город Москва, пр-кт.Волгоградский, д. 128 к 5',
        connection: 'FMC',
        gigabit: false,
        row: 2,
      },
    ])
  })

  it('собирает ошибки по строкам: неизвестная категория, неверное «Да/Нет», окно, ширина строки', () => {
    const rows = [
      syntheticHeader,
      syntheticRow.replace('Конвергенция абонента', 'Новая категория'),
      syntheticRow.replace(';Нет', ';Может быть'),
      syntheticRow.replace('17.08.2026 22:00', '17.08.2026 19:00'),
      'слишком;мало;ячеек',
      officeTail,
    ]
    let error: unknown
    try {
      parseSyntheticCsv(rows.join('\n'), 'east.csv')
    } catch (caught) {
      error = caught
    }
    expect(error).toBeInstanceOf(CsvFormatError)
    const issues = (error as CsvFormatError).issues
    expect(issues.map((issue) => issue.row)).toEqual([5, 2, 3, 4])
    expect(issues.map((issue) => issue.message)).toEqual([
      'ячеек 3, в заголовке 9',
      'Тип заявки HD: неизвестный «Тип заявки HD»',
      'Гигабитное подключение: ожидается «Да» или «Нет»',
      '«Начало» должно быть раньше «Окончание» в тот же день',
    ])
  })

  it('требует строку офиса и отвергает её повтор', () => {
    expect(() => parseSyntheticCsv(`${syntheticHeader}\n${syntheticRow}\n`, 'east.csv')).toThrow(
      /Адрес офиса/,
    )
    expect(() =>
      parseSyntheticCsv(`${syntheticHeader}\n${officeTail}${officeTail}`, 'east.csv'),
    ).toThrow(/повторная/)
  })

  it('пустая колонка «Подключение» становится null, а отсутствующая колонка допустима', () => {
    const header = syntheticHeader.replace(';Подключение', '')
    const row = syntheticRow.replace(';FMC', '')
    const file = parseSyntheticCsv(
      `${header}\n${row}\n${officeTail.replaceAll(';;;;;;;;', ';;;;;;;').replace('д 83с 4;;;;;;;', 'д 83с 4;;;;;;')}`,
      'se.csv',
    )
    expect(file.records[0]?.connection).toBeNull()
  })
})

describe('parseControlCsv', () => {
  const header =
    'Заявка;Тип заявки BK;Статус BK;Тип заявки HD;Начало;Окончание;Район;Адрес;Бригада;Подключение;Гигабитное подключение'
  const row =
    '305927238;Подключение;Не отправлена;Конвергенция абонента;17.08.2026 20:00;17.08.2026 22:00;Кузьминки;Город Москва, пр-кт.Волгоградский, д. 128 к 5, кв. 1;;FMC;Нет'

  it('читает статус и пустую бригаду как null, повтор ID не удаляет', () => {
    const file = parseControlCsv(
      `${header}\n${row}\n${row.replace(';;FMC', ';Бригада Соколов;FMC')}\n`,
      'control.csv',
    )
    expect(file.records).toHaveLength(2)
    expect(file.records[0]).toMatchObject({
      id: '305927238',
      status: 'Не отправлена',
      team: null,
      row: 2,
    })
    expect(file.records[1]).toMatchObject({ id: '305927238', team: 'Бригада Соколов', row: 3 })
  })

  it('не принимает строку офиса и неизвестный статус', () => {
    expect(() =>
      parseControlCsv(`${header}\n${row}\nАдрес офиса;x;;;;;;;;;\n`, 'control.csv'),
    ).toThrow(/строка офиса/)
    expect(() =>
      parseControlCsv(`${header}\n${row.replace('Не отправлена', 'Потеряна')}\n`, 'control.csv'),
    ).toThrow(/Статус BK/)
  })
})
