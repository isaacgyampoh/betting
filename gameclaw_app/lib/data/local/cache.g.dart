// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'cache.dart';

// ignore_for_file: type=lint
class $CachedResponsesTable extends CachedResponses
    with TableInfo<$CachedResponsesTable, CachedResponse> {
  @override
  final GeneratedDatabase attachedDatabase;
  final String? _alias;
  $CachedResponsesTable(this.attachedDatabase, [this._alias]);
  static const VerificationMeta _keyMeta = const VerificationMeta('key');
  @override
  late final GeneratedColumn<String> key = GeneratedColumn<String>(
    'key',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _payloadMeta = const VerificationMeta(
    'payload',
  );
  @override
  late final GeneratedColumn<String> payload = GeneratedColumn<String>(
    'payload',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _fetchedAtMeta = const VerificationMeta(
    'fetchedAt',
  );
  @override
  late final GeneratedColumn<DateTime> fetchedAt = GeneratedColumn<DateTime>(
    'fetched_at',
    aliasedName,
    false,
    type: DriftSqlType.dateTime,
    requiredDuringInsert: true,
  );
  @override
  List<GeneratedColumn> get $columns => [key, payload, fetchedAt];
  @override
  String get aliasedName => _alias ?? actualTableName;
  @override
  String get actualTableName => $name;
  static const String $name = 'cached_responses';
  @override
  VerificationContext validateIntegrity(
    Insertable<CachedResponse> instance, {
    bool isInserting = false,
  }) {
    final context = VerificationContext();
    final data = instance.toColumns(true);
    if (data.containsKey('key')) {
      context.handle(
        _keyMeta,
        key.isAcceptableOrUnknown(data['key']!, _keyMeta),
      );
    } else if (isInserting) {
      context.missing(_keyMeta);
    }
    if (data.containsKey('payload')) {
      context.handle(
        _payloadMeta,
        payload.isAcceptableOrUnknown(data['payload']!, _payloadMeta),
      );
    } else if (isInserting) {
      context.missing(_payloadMeta);
    }
    if (data.containsKey('fetched_at')) {
      context.handle(
        _fetchedAtMeta,
        fetchedAt.isAcceptableOrUnknown(data['fetched_at']!, _fetchedAtMeta),
      );
    } else if (isInserting) {
      context.missing(_fetchedAtMeta);
    }
    return context;
  }

  @override
  Set<GeneratedColumn> get $primaryKey => {key};
  @override
  CachedResponse map(Map<String, dynamic> data, {String? tablePrefix}) {
    final effectivePrefix = tablePrefix != null ? '$tablePrefix.' : '';
    return CachedResponse(
      key: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}key'],
      )!,
      payload: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}payload'],
      )!,
      fetchedAt: attachedDatabase.typeMapping.read(
        DriftSqlType.dateTime,
        data['${effectivePrefix}fetched_at'],
      )!,
    );
  }

  @override
  $CachedResponsesTable createAlias(String alias) {
    return $CachedResponsesTable(attachedDatabase, alias);
  }
}

class CachedResponse extends DataClass implements Insertable<CachedResponse> {
  /// The request: path plus whichever query parameters change the answer.
  final String key;

  /// The response body, exactly as received.
  final String payload;
  final DateTime fetchedAt;
  const CachedResponse({
    required this.key,
    required this.payload,
    required this.fetchedAt,
  });
  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    map['key'] = Variable<String>(key);
    map['payload'] = Variable<String>(payload);
    map['fetched_at'] = Variable<DateTime>(fetchedAt);
    return map;
  }

  CachedResponsesCompanion toCompanion(bool nullToAbsent) {
    return CachedResponsesCompanion(
      key: Value(key),
      payload: Value(payload),
      fetchedAt: Value(fetchedAt),
    );
  }

  factory CachedResponse.fromJson(
    Map<String, dynamic> json, {
    ValueSerializer? serializer,
  }) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return CachedResponse(
      key: serializer.fromJson<String>(json['key']),
      payload: serializer.fromJson<String>(json['payload']),
      fetchedAt: serializer.fromJson<DateTime>(json['fetchedAt']),
    );
  }
  @override
  Map<String, dynamic> toJson({ValueSerializer? serializer}) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return <String, dynamic>{
      'key': serializer.toJson<String>(key),
      'payload': serializer.toJson<String>(payload),
      'fetchedAt': serializer.toJson<DateTime>(fetchedAt),
    };
  }

  CachedResponse copyWith({
    String? key,
    String? payload,
    DateTime? fetchedAt,
  }) => CachedResponse(
    key: key ?? this.key,
    payload: payload ?? this.payload,
    fetchedAt: fetchedAt ?? this.fetchedAt,
  );
  CachedResponse copyWithCompanion(CachedResponsesCompanion data) {
    return CachedResponse(
      key: data.key.present ? data.key.value : this.key,
      payload: data.payload.present ? data.payload.value : this.payload,
      fetchedAt: data.fetchedAt.present ? data.fetchedAt.value : this.fetchedAt,
    );
  }

  @override
  String toString() {
    return (StringBuffer('CachedResponse(')
          ..write('key: $key, ')
          ..write('payload: $payload, ')
          ..write('fetchedAt: $fetchedAt')
          ..write(')'))
        .toString();
  }

  @override
  int get hashCode => Object.hash(key, payload, fetchedAt);
  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      (other is CachedResponse &&
          other.key == this.key &&
          other.payload == this.payload &&
          other.fetchedAt == this.fetchedAt);
}

class CachedResponsesCompanion extends UpdateCompanion<CachedResponse> {
  final Value<String> key;
  final Value<String> payload;
  final Value<DateTime> fetchedAt;
  final Value<int> rowid;
  const CachedResponsesCompanion({
    this.key = const Value.absent(),
    this.payload = const Value.absent(),
    this.fetchedAt = const Value.absent(),
    this.rowid = const Value.absent(),
  });
  CachedResponsesCompanion.insert({
    required String key,
    required String payload,
    required DateTime fetchedAt,
    this.rowid = const Value.absent(),
  }) : key = Value(key),
       payload = Value(payload),
       fetchedAt = Value(fetchedAt);
  static Insertable<CachedResponse> custom({
    Expression<String>? key,
    Expression<String>? payload,
    Expression<DateTime>? fetchedAt,
    Expression<int>? rowid,
  }) {
    return RawValuesInsertable({
      if (key != null) 'key': key,
      if (payload != null) 'payload': payload,
      if (fetchedAt != null) 'fetched_at': fetchedAt,
      if (rowid != null) 'rowid': rowid,
    });
  }

  CachedResponsesCompanion copyWith({
    Value<String>? key,
    Value<String>? payload,
    Value<DateTime>? fetchedAt,
    Value<int>? rowid,
  }) {
    return CachedResponsesCompanion(
      key: key ?? this.key,
      payload: payload ?? this.payload,
      fetchedAt: fetchedAt ?? this.fetchedAt,
      rowid: rowid ?? this.rowid,
    );
  }

  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    if (key.present) {
      map['key'] = Variable<String>(key.value);
    }
    if (payload.present) {
      map['payload'] = Variable<String>(payload.value);
    }
    if (fetchedAt.present) {
      map['fetched_at'] = Variable<DateTime>(fetchedAt.value);
    }
    if (rowid.present) {
      map['rowid'] = Variable<int>(rowid.value);
    }
    return map;
  }

  @override
  String toString() {
    return (StringBuffer('CachedResponsesCompanion(')
          ..write('key: $key, ')
          ..write('payload: $payload, ')
          ..write('fetchedAt: $fetchedAt, ')
          ..write('rowid: $rowid')
          ..write(')'))
        .toString();
  }
}

class $FavouriteTeamsTable extends FavouriteTeams
    with TableInfo<$FavouriteTeamsTable, FavouriteTeam> {
  @override
  final GeneratedDatabase attachedDatabase;
  final String? _alias;
  $FavouriteTeamsTable(this.attachedDatabase, [this._alias]);
  static const VerificationMeta _teamIdMeta = const VerificationMeta('teamId');
  @override
  late final GeneratedColumn<int> teamId = GeneratedColumn<int>(
    'team_id',
    aliasedName,
    false,
    type: DriftSqlType.int,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _nameMeta = const VerificationMeta('name');
  @override
  late final GeneratedColumn<String> name = GeneratedColumn<String>(
    'name',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _logoUrlMeta = const VerificationMeta(
    'logoUrl',
  );
  @override
  late final GeneratedColumn<String> logoUrl = GeneratedColumn<String>(
    'logo_url',
    aliasedName,
    true,
    type: DriftSqlType.string,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _addedAtMeta = const VerificationMeta(
    'addedAt',
  );
  @override
  late final GeneratedColumn<DateTime> addedAt = GeneratedColumn<DateTime>(
    'added_at',
    aliasedName,
    false,
    type: DriftSqlType.dateTime,
    requiredDuringInsert: true,
  );
  @override
  List<GeneratedColumn> get $columns => [teamId, name, logoUrl, addedAt];
  @override
  String get aliasedName => _alias ?? actualTableName;
  @override
  String get actualTableName => $name;
  static const String $name = 'favourite_teams';
  @override
  VerificationContext validateIntegrity(
    Insertable<FavouriteTeam> instance, {
    bool isInserting = false,
  }) {
    final context = VerificationContext();
    final data = instance.toColumns(true);
    if (data.containsKey('team_id')) {
      context.handle(
        _teamIdMeta,
        teamId.isAcceptableOrUnknown(data['team_id']!, _teamIdMeta),
      );
    }
    if (data.containsKey('name')) {
      context.handle(
        _nameMeta,
        name.isAcceptableOrUnknown(data['name']!, _nameMeta),
      );
    } else if (isInserting) {
      context.missing(_nameMeta);
    }
    if (data.containsKey('logo_url')) {
      context.handle(
        _logoUrlMeta,
        logoUrl.isAcceptableOrUnknown(data['logo_url']!, _logoUrlMeta),
      );
    }
    if (data.containsKey('added_at')) {
      context.handle(
        _addedAtMeta,
        addedAt.isAcceptableOrUnknown(data['added_at']!, _addedAtMeta),
      );
    } else if (isInserting) {
      context.missing(_addedAtMeta);
    }
    return context;
  }

  @override
  Set<GeneratedColumn> get $primaryKey => {teamId};
  @override
  FavouriteTeam map(Map<String, dynamic> data, {String? tablePrefix}) {
    final effectivePrefix = tablePrefix != null ? '$tablePrefix.' : '';
    return FavouriteTeam(
      teamId: attachedDatabase.typeMapping.read(
        DriftSqlType.int,
        data['${effectivePrefix}team_id'],
      )!,
      name: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}name'],
      )!,
      logoUrl: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}logo_url'],
      ),
      addedAt: attachedDatabase.typeMapping.read(
        DriftSqlType.dateTime,
        data['${effectivePrefix}added_at'],
      )!,
    );
  }

  @override
  $FavouriteTeamsTable createAlias(String alias) {
    return $FavouriteTeamsTable(attachedDatabase, alias);
  }
}

class FavouriteTeam extends DataClass implements Insertable<FavouriteTeam> {
  final int teamId;
  final String name;
  final String? logoUrl;
  final DateTime addedAt;
  const FavouriteTeam({
    required this.teamId,
    required this.name,
    this.logoUrl,
    required this.addedAt,
  });
  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    map['team_id'] = Variable<int>(teamId);
    map['name'] = Variable<String>(name);
    if (!nullToAbsent || logoUrl != null) {
      map['logo_url'] = Variable<String>(logoUrl);
    }
    map['added_at'] = Variable<DateTime>(addedAt);
    return map;
  }

  FavouriteTeamsCompanion toCompanion(bool nullToAbsent) {
    return FavouriteTeamsCompanion(
      teamId: Value(teamId),
      name: Value(name),
      logoUrl: logoUrl == null && nullToAbsent
          ? const Value.absent()
          : Value(logoUrl),
      addedAt: Value(addedAt),
    );
  }

  factory FavouriteTeam.fromJson(
    Map<String, dynamic> json, {
    ValueSerializer? serializer,
  }) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return FavouriteTeam(
      teamId: serializer.fromJson<int>(json['teamId']),
      name: serializer.fromJson<String>(json['name']),
      logoUrl: serializer.fromJson<String?>(json['logoUrl']),
      addedAt: serializer.fromJson<DateTime>(json['addedAt']),
    );
  }
  @override
  Map<String, dynamic> toJson({ValueSerializer? serializer}) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return <String, dynamic>{
      'teamId': serializer.toJson<int>(teamId),
      'name': serializer.toJson<String>(name),
      'logoUrl': serializer.toJson<String?>(logoUrl),
      'addedAt': serializer.toJson<DateTime>(addedAt),
    };
  }

  FavouriteTeam copyWith({
    int? teamId,
    String? name,
    Value<String?> logoUrl = const Value.absent(),
    DateTime? addedAt,
  }) => FavouriteTeam(
    teamId: teamId ?? this.teamId,
    name: name ?? this.name,
    logoUrl: logoUrl.present ? logoUrl.value : this.logoUrl,
    addedAt: addedAt ?? this.addedAt,
  );
  FavouriteTeam copyWithCompanion(FavouriteTeamsCompanion data) {
    return FavouriteTeam(
      teamId: data.teamId.present ? data.teamId.value : this.teamId,
      name: data.name.present ? data.name.value : this.name,
      logoUrl: data.logoUrl.present ? data.logoUrl.value : this.logoUrl,
      addedAt: data.addedAt.present ? data.addedAt.value : this.addedAt,
    );
  }

  @override
  String toString() {
    return (StringBuffer('FavouriteTeam(')
          ..write('teamId: $teamId, ')
          ..write('name: $name, ')
          ..write('logoUrl: $logoUrl, ')
          ..write('addedAt: $addedAt')
          ..write(')'))
        .toString();
  }

  @override
  int get hashCode => Object.hash(teamId, name, logoUrl, addedAt);
  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      (other is FavouriteTeam &&
          other.teamId == this.teamId &&
          other.name == this.name &&
          other.logoUrl == this.logoUrl &&
          other.addedAt == this.addedAt);
}

class FavouriteTeamsCompanion extends UpdateCompanion<FavouriteTeam> {
  final Value<int> teamId;
  final Value<String> name;
  final Value<String?> logoUrl;
  final Value<DateTime> addedAt;
  const FavouriteTeamsCompanion({
    this.teamId = const Value.absent(),
    this.name = const Value.absent(),
    this.logoUrl = const Value.absent(),
    this.addedAt = const Value.absent(),
  });
  FavouriteTeamsCompanion.insert({
    this.teamId = const Value.absent(),
    required String name,
    this.logoUrl = const Value.absent(),
    required DateTime addedAt,
  }) : name = Value(name),
       addedAt = Value(addedAt);
  static Insertable<FavouriteTeam> custom({
    Expression<int>? teamId,
    Expression<String>? name,
    Expression<String>? logoUrl,
    Expression<DateTime>? addedAt,
  }) {
    return RawValuesInsertable({
      if (teamId != null) 'team_id': teamId,
      if (name != null) 'name': name,
      if (logoUrl != null) 'logo_url': logoUrl,
      if (addedAt != null) 'added_at': addedAt,
    });
  }

  FavouriteTeamsCompanion copyWith({
    Value<int>? teamId,
    Value<String>? name,
    Value<String?>? logoUrl,
    Value<DateTime>? addedAt,
  }) {
    return FavouriteTeamsCompanion(
      teamId: teamId ?? this.teamId,
      name: name ?? this.name,
      logoUrl: logoUrl ?? this.logoUrl,
      addedAt: addedAt ?? this.addedAt,
    );
  }

  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    if (teamId.present) {
      map['team_id'] = Variable<int>(teamId.value);
    }
    if (name.present) {
      map['name'] = Variable<String>(name.value);
    }
    if (logoUrl.present) {
      map['logo_url'] = Variable<String>(logoUrl.value);
    }
    if (addedAt.present) {
      map['added_at'] = Variable<DateTime>(addedAt.value);
    }
    return map;
  }

  @override
  String toString() {
    return (StringBuffer('FavouriteTeamsCompanion(')
          ..write('teamId: $teamId, ')
          ..write('name: $name, ')
          ..write('logoUrl: $logoUrl, ')
          ..write('addedAt: $addedAt')
          ..write(')'))
        .toString();
  }
}

class $FollowedMatchesTable extends FollowedMatches
    with TableInfo<$FollowedMatchesTable, FollowedMatch> {
  @override
  final GeneratedDatabase attachedDatabase;
  final String? _alias;
  $FollowedMatchesTable(this.attachedDatabase, [this._alias]);
  static const VerificationMeta _fixtureIdMeta = const VerificationMeta(
    'fixtureId',
  );
  @override
  late final GeneratedColumn<int> fixtureId = GeneratedColumn<int>(
    'fixture_id',
    aliasedName,
    false,
    type: DriftSqlType.int,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _labelMeta = const VerificationMeta('label');
  @override
  late final GeneratedColumn<String> label = GeneratedColumn<String>(
    'label',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _kickoffAtMeta = const VerificationMeta(
    'kickoffAt',
  );
  @override
  late final GeneratedColumn<DateTime> kickoffAt = GeneratedColumn<DateTime>(
    'kickoff_at',
    aliasedName,
    true,
    type: DriftSqlType.dateTime,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _mutedMeta = const VerificationMeta('muted');
  @override
  late final GeneratedColumn<bool> muted = GeneratedColumn<bool>(
    'muted',
    aliasedName,
    false,
    type: DriftSqlType.bool,
    requiredDuringInsert: false,
    defaultConstraints: GeneratedColumn.constraintIsAlways(
      'CHECK ("muted" IN (0, 1))',
    ),
    defaultValue: const Constant(false),
  );
  static const VerificationMeta _addedAtMeta = const VerificationMeta(
    'addedAt',
  );
  @override
  late final GeneratedColumn<DateTime> addedAt = GeneratedColumn<DateTime>(
    'added_at',
    aliasedName,
    false,
    type: DriftSqlType.dateTime,
    requiredDuringInsert: true,
  );
  @override
  List<GeneratedColumn> get $columns => [
    fixtureId,
    label,
    kickoffAt,
    muted,
    addedAt,
  ];
  @override
  String get aliasedName => _alias ?? actualTableName;
  @override
  String get actualTableName => $name;
  static const String $name = 'followed_matches';
  @override
  VerificationContext validateIntegrity(
    Insertable<FollowedMatch> instance, {
    bool isInserting = false,
  }) {
    final context = VerificationContext();
    final data = instance.toColumns(true);
    if (data.containsKey('fixture_id')) {
      context.handle(
        _fixtureIdMeta,
        fixtureId.isAcceptableOrUnknown(data['fixture_id']!, _fixtureIdMeta),
      );
    }
    if (data.containsKey('label')) {
      context.handle(
        _labelMeta,
        label.isAcceptableOrUnknown(data['label']!, _labelMeta),
      );
    } else if (isInserting) {
      context.missing(_labelMeta);
    }
    if (data.containsKey('kickoff_at')) {
      context.handle(
        _kickoffAtMeta,
        kickoffAt.isAcceptableOrUnknown(data['kickoff_at']!, _kickoffAtMeta),
      );
    }
    if (data.containsKey('muted')) {
      context.handle(
        _mutedMeta,
        muted.isAcceptableOrUnknown(data['muted']!, _mutedMeta),
      );
    }
    if (data.containsKey('added_at')) {
      context.handle(
        _addedAtMeta,
        addedAt.isAcceptableOrUnknown(data['added_at']!, _addedAtMeta),
      );
    } else if (isInserting) {
      context.missing(_addedAtMeta);
    }
    return context;
  }

  @override
  Set<GeneratedColumn> get $primaryKey => {fixtureId};
  @override
  FollowedMatch map(Map<String, dynamic> data, {String? tablePrefix}) {
    final effectivePrefix = tablePrefix != null ? '$tablePrefix.' : '';
    return FollowedMatch(
      fixtureId: attachedDatabase.typeMapping.read(
        DriftSqlType.int,
        data['${effectivePrefix}fixture_id'],
      )!,
      label: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}label'],
      )!,
      kickoffAt: attachedDatabase.typeMapping.read(
        DriftSqlType.dateTime,
        data['${effectivePrefix}kickoff_at'],
      ),
      muted: attachedDatabase.typeMapping.read(
        DriftSqlType.bool,
        data['${effectivePrefix}muted'],
      )!,
      addedAt: attachedDatabase.typeMapping.read(
        DriftSqlType.dateTime,
        data['${effectivePrefix}added_at'],
      )!,
    );
  }

  @override
  $FollowedMatchesTable createAlias(String alias) {
    return $FollowedMatchesTable(attachedDatabase, alias);
  }
}

class FollowedMatch extends DataClass implements Insertable<FollowedMatch> {
  final int fixtureId;
  final String label;

  /// Named `At`, not `Utc`, because drift stores a DateTime as epoch seconds and hands it
  /// back with isUtc false - the instant is preserved exactly, but expressed in local time.
  /// Calling it Utc invited reading the wall-clock numbers as UTC, which is only harmless in a
  /// UTC+0 timezone and this is not only shipped in one.
  final DateTime? kickoffAt;

  /// Silenced without unfollowing: it stays on the Following screen, it just says nothing.
  final bool muted;
  final DateTime addedAt;
  const FollowedMatch({
    required this.fixtureId,
    required this.label,
    this.kickoffAt,
    required this.muted,
    required this.addedAt,
  });
  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    map['fixture_id'] = Variable<int>(fixtureId);
    map['label'] = Variable<String>(label);
    if (!nullToAbsent || kickoffAt != null) {
      map['kickoff_at'] = Variable<DateTime>(kickoffAt);
    }
    map['muted'] = Variable<bool>(muted);
    map['added_at'] = Variable<DateTime>(addedAt);
    return map;
  }

  FollowedMatchesCompanion toCompanion(bool nullToAbsent) {
    return FollowedMatchesCompanion(
      fixtureId: Value(fixtureId),
      label: Value(label),
      kickoffAt: kickoffAt == null && nullToAbsent
          ? const Value.absent()
          : Value(kickoffAt),
      muted: Value(muted),
      addedAt: Value(addedAt),
    );
  }

  factory FollowedMatch.fromJson(
    Map<String, dynamic> json, {
    ValueSerializer? serializer,
  }) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return FollowedMatch(
      fixtureId: serializer.fromJson<int>(json['fixtureId']),
      label: serializer.fromJson<String>(json['label']),
      kickoffAt: serializer.fromJson<DateTime?>(json['kickoffAt']),
      muted: serializer.fromJson<bool>(json['muted']),
      addedAt: serializer.fromJson<DateTime>(json['addedAt']),
    );
  }
  @override
  Map<String, dynamic> toJson({ValueSerializer? serializer}) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return <String, dynamic>{
      'fixtureId': serializer.toJson<int>(fixtureId),
      'label': serializer.toJson<String>(label),
      'kickoffAt': serializer.toJson<DateTime?>(kickoffAt),
      'muted': serializer.toJson<bool>(muted),
      'addedAt': serializer.toJson<DateTime>(addedAt),
    };
  }

  FollowedMatch copyWith({
    int? fixtureId,
    String? label,
    Value<DateTime?> kickoffAt = const Value.absent(),
    bool? muted,
    DateTime? addedAt,
  }) => FollowedMatch(
    fixtureId: fixtureId ?? this.fixtureId,
    label: label ?? this.label,
    kickoffAt: kickoffAt.present ? kickoffAt.value : this.kickoffAt,
    muted: muted ?? this.muted,
    addedAt: addedAt ?? this.addedAt,
  );
  FollowedMatch copyWithCompanion(FollowedMatchesCompanion data) {
    return FollowedMatch(
      fixtureId: data.fixtureId.present ? data.fixtureId.value : this.fixtureId,
      label: data.label.present ? data.label.value : this.label,
      kickoffAt: data.kickoffAt.present ? data.kickoffAt.value : this.kickoffAt,
      muted: data.muted.present ? data.muted.value : this.muted,
      addedAt: data.addedAt.present ? data.addedAt.value : this.addedAt,
    );
  }

  @override
  String toString() {
    return (StringBuffer('FollowedMatch(')
          ..write('fixtureId: $fixtureId, ')
          ..write('label: $label, ')
          ..write('kickoffAt: $kickoffAt, ')
          ..write('muted: $muted, ')
          ..write('addedAt: $addedAt')
          ..write(')'))
        .toString();
  }

  @override
  int get hashCode => Object.hash(fixtureId, label, kickoffAt, muted, addedAt);
  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      (other is FollowedMatch &&
          other.fixtureId == this.fixtureId &&
          other.label == this.label &&
          other.kickoffAt == this.kickoffAt &&
          other.muted == this.muted &&
          other.addedAt == this.addedAt);
}

class FollowedMatchesCompanion extends UpdateCompanion<FollowedMatch> {
  final Value<int> fixtureId;
  final Value<String> label;
  final Value<DateTime?> kickoffAt;
  final Value<bool> muted;
  final Value<DateTime> addedAt;
  const FollowedMatchesCompanion({
    this.fixtureId = const Value.absent(),
    this.label = const Value.absent(),
    this.kickoffAt = const Value.absent(),
    this.muted = const Value.absent(),
    this.addedAt = const Value.absent(),
  });
  FollowedMatchesCompanion.insert({
    this.fixtureId = const Value.absent(),
    required String label,
    this.kickoffAt = const Value.absent(),
    this.muted = const Value.absent(),
    required DateTime addedAt,
  }) : label = Value(label),
       addedAt = Value(addedAt);
  static Insertable<FollowedMatch> custom({
    Expression<int>? fixtureId,
    Expression<String>? label,
    Expression<DateTime>? kickoffAt,
    Expression<bool>? muted,
    Expression<DateTime>? addedAt,
  }) {
    return RawValuesInsertable({
      if (fixtureId != null) 'fixture_id': fixtureId,
      if (label != null) 'label': label,
      if (kickoffAt != null) 'kickoff_at': kickoffAt,
      if (muted != null) 'muted': muted,
      if (addedAt != null) 'added_at': addedAt,
    });
  }

  FollowedMatchesCompanion copyWith({
    Value<int>? fixtureId,
    Value<String>? label,
    Value<DateTime?>? kickoffAt,
    Value<bool>? muted,
    Value<DateTime>? addedAt,
  }) {
    return FollowedMatchesCompanion(
      fixtureId: fixtureId ?? this.fixtureId,
      label: label ?? this.label,
      kickoffAt: kickoffAt ?? this.kickoffAt,
      muted: muted ?? this.muted,
      addedAt: addedAt ?? this.addedAt,
    );
  }

  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    if (fixtureId.present) {
      map['fixture_id'] = Variable<int>(fixtureId.value);
    }
    if (label.present) {
      map['label'] = Variable<String>(label.value);
    }
    if (kickoffAt.present) {
      map['kickoff_at'] = Variable<DateTime>(kickoffAt.value);
    }
    if (muted.present) {
      map['muted'] = Variable<bool>(muted.value);
    }
    if (addedAt.present) {
      map['added_at'] = Variable<DateTime>(addedAt.value);
    }
    return map;
  }

  @override
  String toString() {
    return (StringBuffer('FollowedMatchesCompanion(')
          ..write('fixtureId: $fixtureId, ')
          ..write('label: $label, ')
          ..write('kickoffAt: $kickoffAt, ')
          ..write('muted: $muted, ')
          ..write('addedAt: $addedAt')
          ..write(')'))
        .toString();
  }
}

abstract class _$CacheDb extends GeneratedDatabase {
  _$CacheDb(QueryExecutor e) : super(e);
  $CacheDbManager get managers => $CacheDbManager(this);
  late final $CachedResponsesTable cachedResponses = $CachedResponsesTable(
    this,
  );
  late final $FavouriteTeamsTable favouriteTeams = $FavouriteTeamsTable(this);
  late final $FollowedMatchesTable followedMatches = $FollowedMatchesTable(
    this,
  );
  @override
  Iterable<TableInfo<Table, Object?>> get allTables =>
      allSchemaEntities.whereType<TableInfo<Table, Object?>>();
  @override
  List<DatabaseSchemaEntity> get allSchemaEntities => [
    cachedResponses,
    favouriteTeams,
    followedMatches,
  ];
}

typedef $$CachedResponsesTableCreateCompanionBuilder =
    CachedResponsesCompanion Function({
      required String key,
      required String payload,
      required DateTime fetchedAt,
      Value<int> rowid,
    });
typedef $$CachedResponsesTableUpdateCompanionBuilder =
    CachedResponsesCompanion Function({
      Value<String> key,
      Value<String> payload,
      Value<DateTime> fetchedAt,
      Value<int> rowid,
    });

class $$CachedResponsesTableFilterComposer
    extends Composer<_$CacheDb, $CachedResponsesTable> {
  $$CachedResponsesTableFilterComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnFilters<String> get key => $composableBuilder(
    column: $table.key,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get payload => $composableBuilder(
    column: $table.payload,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<DateTime> get fetchedAt => $composableBuilder(
    column: $table.fetchedAt,
    builder: (column) => ColumnFilters(column),
  );
}

class $$CachedResponsesTableOrderingComposer
    extends Composer<_$CacheDb, $CachedResponsesTable> {
  $$CachedResponsesTableOrderingComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnOrderings<String> get key => $composableBuilder(
    column: $table.key,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get payload => $composableBuilder(
    column: $table.payload,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<DateTime> get fetchedAt => $composableBuilder(
    column: $table.fetchedAt,
    builder: (column) => ColumnOrderings(column),
  );
}

class $$CachedResponsesTableAnnotationComposer
    extends Composer<_$CacheDb, $CachedResponsesTable> {
  $$CachedResponsesTableAnnotationComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  GeneratedColumn<String> get key =>
      $composableBuilder(column: $table.key, builder: (column) => column);

  GeneratedColumn<String> get payload =>
      $composableBuilder(column: $table.payload, builder: (column) => column);

  GeneratedColumn<DateTime> get fetchedAt =>
      $composableBuilder(column: $table.fetchedAt, builder: (column) => column);
}

class $$CachedResponsesTableTableManager
    extends
        RootTableManager<
          _$CacheDb,
          $CachedResponsesTable,
          CachedResponse,
          $$CachedResponsesTableFilterComposer,
          $$CachedResponsesTableOrderingComposer,
          $$CachedResponsesTableAnnotationComposer,
          $$CachedResponsesTableCreateCompanionBuilder,
          $$CachedResponsesTableUpdateCompanionBuilder,
          (
            CachedResponse,
            BaseReferences<_$CacheDb, $CachedResponsesTable, CachedResponse>,
          ),
          CachedResponse,
          PrefetchHooks Function()
        > {
  $$CachedResponsesTableTableManager(_$CacheDb db, $CachedResponsesTable table)
    : super(
        TableManagerState(
          db: db,
          table: table,
          createFilteringComposer: () =>
              $$CachedResponsesTableFilterComposer($db: db, $table: table),
          createOrderingComposer: () =>
              $$CachedResponsesTableOrderingComposer($db: db, $table: table),
          createComputedFieldComposer: () =>
              $$CachedResponsesTableAnnotationComposer($db: db, $table: table),
          updateCompanionCallback:
              ({
                Value<String> key = const Value.absent(),
                Value<String> payload = const Value.absent(),
                Value<DateTime> fetchedAt = const Value.absent(),
                Value<int> rowid = const Value.absent(),
              }) => CachedResponsesCompanion(
                key: key,
                payload: payload,
                fetchedAt: fetchedAt,
                rowid: rowid,
              ),
          createCompanionCallback:
              ({
                required String key,
                required String payload,
                required DateTime fetchedAt,
                Value<int> rowid = const Value.absent(),
              }) => CachedResponsesCompanion.insert(
                key: key,
                payload: payload,
                fetchedAt: fetchedAt,
                rowid: rowid,
              ),
          withReferenceMapper: (p0) => p0
              .map((e) => (e.readTable(table), BaseReferences(db, table, e)))
              .toList(),
          prefetchHooksCallback: null,
        ),
      );
}

typedef $$CachedResponsesTableProcessedTableManager =
    ProcessedTableManager<
      _$CacheDb,
      $CachedResponsesTable,
      CachedResponse,
      $$CachedResponsesTableFilterComposer,
      $$CachedResponsesTableOrderingComposer,
      $$CachedResponsesTableAnnotationComposer,
      $$CachedResponsesTableCreateCompanionBuilder,
      $$CachedResponsesTableUpdateCompanionBuilder,
      (
        CachedResponse,
        BaseReferences<_$CacheDb, $CachedResponsesTable, CachedResponse>,
      ),
      CachedResponse,
      PrefetchHooks Function()
    >;
typedef $$FavouriteTeamsTableCreateCompanionBuilder =
    FavouriteTeamsCompanion Function({
      Value<int> teamId,
      required String name,
      Value<String?> logoUrl,
      required DateTime addedAt,
    });
typedef $$FavouriteTeamsTableUpdateCompanionBuilder =
    FavouriteTeamsCompanion Function({
      Value<int> teamId,
      Value<String> name,
      Value<String?> logoUrl,
      Value<DateTime> addedAt,
    });

class $$FavouriteTeamsTableFilterComposer
    extends Composer<_$CacheDb, $FavouriteTeamsTable> {
  $$FavouriteTeamsTableFilterComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnFilters<int> get teamId => $composableBuilder(
    column: $table.teamId,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get name => $composableBuilder(
    column: $table.name,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get logoUrl => $composableBuilder(
    column: $table.logoUrl,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<DateTime> get addedAt => $composableBuilder(
    column: $table.addedAt,
    builder: (column) => ColumnFilters(column),
  );
}

class $$FavouriteTeamsTableOrderingComposer
    extends Composer<_$CacheDb, $FavouriteTeamsTable> {
  $$FavouriteTeamsTableOrderingComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnOrderings<int> get teamId => $composableBuilder(
    column: $table.teamId,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get name => $composableBuilder(
    column: $table.name,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get logoUrl => $composableBuilder(
    column: $table.logoUrl,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<DateTime> get addedAt => $composableBuilder(
    column: $table.addedAt,
    builder: (column) => ColumnOrderings(column),
  );
}

class $$FavouriteTeamsTableAnnotationComposer
    extends Composer<_$CacheDb, $FavouriteTeamsTable> {
  $$FavouriteTeamsTableAnnotationComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  GeneratedColumn<int> get teamId =>
      $composableBuilder(column: $table.teamId, builder: (column) => column);

  GeneratedColumn<String> get name =>
      $composableBuilder(column: $table.name, builder: (column) => column);

  GeneratedColumn<String> get logoUrl =>
      $composableBuilder(column: $table.logoUrl, builder: (column) => column);

  GeneratedColumn<DateTime> get addedAt =>
      $composableBuilder(column: $table.addedAt, builder: (column) => column);
}

class $$FavouriteTeamsTableTableManager
    extends
        RootTableManager<
          _$CacheDb,
          $FavouriteTeamsTable,
          FavouriteTeam,
          $$FavouriteTeamsTableFilterComposer,
          $$FavouriteTeamsTableOrderingComposer,
          $$FavouriteTeamsTableAnnotationComposer,
          $$FavouriteTeamsTableCreateCompanionBuilder,
          $$FavouriteTeamsTableUpdateCompanionBuilder,
          (
            FavouriteTeam,
            BaseReferences<_$CacheDb, $FavouriteTeamsTable, FavouriteTeam>,
          ),
          FavouriteTeam,
          PrefetchHooks Function()
        > {
  $$FavouriteTeamsTableTableManager(_$CacheDb db, $FavouriteTeamsTable table)
    : super(
        TableManagerState(
          db: db,
          table: table,
          createFilteringComposer: () =>
              $$FavouriteTeamsTableFilterComposer($db: db, $table: table),
          createOrderingComposer: () =>
              $$FavouriteTeamsTableOrderingComposer($db: db, $table: table),
          createComputedFieldComposer: () =>
              $$FavouriteTeamsTableAnnotationComposer($db: db, $table: table),
          updateCompanionCallback:
              ({
                Value<int> teamId = const Value.absent(),
                Value<String> name = const Value.absent(),
                Value<String?> logoUrl = const Value.absent(),
                Value<DateTime> addedAt = const Value.absent(),
              }) => FavouriteTeamsCompanion(
                teamId: teamId,
                name: name,
                logoUrl: logoUrl,
                addedAt: addedAt,
              ),
          createCompanionCallback:
              ({
                Value<int> teamId = const Value.absent(),
                required String name,
                Value<String?> logoUrl = const Value.absent(),
                required DateTime addedAt,
              }) => FavouriteTeamsCompanion.insert(
                teamId: teamId,
                name: name,
                logoUrl: logoUrl,
                addedAt: addedAt,
              ),
          withReferenceMapper: (p0) => p0
              .map((e) => (e.readTable(table), BaseReferences(db, table, e)))
              .toList(),
          prefetchHooksCallback: null,
        ),
      );
}

typedef $$FavouriteTeamsTableProcessedTableManager =
    ProcessedTableManager<
      _$CacheDb,
      $FavouriteTeamsTable,
      FavouriteTeam,
      $$FavouriteTeamsTableFilterComposer,
      $$FavouriteTeamsTableOrderingComposer,
      $$FavouriteTeamsTableAnnotationComposer,
      $$FavouriteTeamsTableCreateCompanionBuilder,
      $$FavouriteTeamsTableUpdateCompanionBuilder,
      (
        FavouriteTeam,
        BaseReferences<_$CacheDb, $FavouriteTeamsTable, FavouriteTeam>,
      ),
      FavouriteTeam,
      PrefetchHooks Function()
    >;
typedef $$FollowedMatchesTableCreateCompanionBuilder =
    FollowedMatchesCompanion Function({
      Value<int> fixtureId,
      required String label,
      Value<DateTime?> kickoffAt,
      Value<bool> muted,
      required DateTime addedAt,
    });
typedef $$FollowedMatchesTableUpdateCompanionBuilder =
    FollowedMatchesCompanion Function({
      Value<int> fixtureId,
      Value<String> label,
      Value<DateTime?> kickoffAt,
      Value<bool> muted,
      Value<DateTime> addedAt,
    });

class $$FollowedMatchesTableFilterComposer
    extends Composer<_$CacheDb, $FollowedMatchesTable> {
  $$FollowedMatchesTableFilterComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnFilters<int> get fixtureId => $composableBuilder(
    column: $table.fixtureId,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get label => $composableBuilder(
    column: $table.label,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<DateTime> get kickoffAt => $composableBuilder(
    column: $table.kickoffAt,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<bool> get muted => $composableBuilder(
    column: $table.muted,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<DateTime> get addedAt => $composableBuilder(
    column: $table.addedAt,
    builder: (column) => ColumnFilters(column),
  );
}

class $$FollowedMatchesTableOrderingComposer
    extends Composer<_$CacheDb, $FollowedMatchesTable> {
  $$FollowedMatchesTableOrderingComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnOrderings<int> get fixtureId => $composableBuilder(
    column: $table.fixtureId,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get label => $composableBuilder(
    column: $table.label,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<DateTime> get kickoffAt => $composableBuilder(
    column: $table.kickoffAt,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<bool> get muted => $composableBuilder(
    column: $table.muted,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<DateTime> get addedAt => $composableBuilder(
    column: $table.addedAt,
    builder: (column) => ColumnOrderings(column),
  );
}

class $$FollowedMatchesTableAnnotationComposer
    extends Composer<_$CacheDb, $FollowedMatchesTable> {
  $$FollowedMatchesTableAnnotationComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  GeneratedColumn<int> get fixtureId =>
      $composableBuilder(column: $table.fixtureId, builder: (column) => column);

  GeneratedColumn<String> get label =>
      $composableBuilder(column: $table.label, builder: (column) => column);

  GeneratedColumn<DateTime> get kickoffAt =>
      $composableBuilder(column: $table.kickoffAt, builder: (column) => column);

  GeneratedColumn<bool> get muted =>
      $composableBuilder(column: $table.muted, builder: (column) => column);

  GeneratedColumn<DateTime> get addedAt =>
      $composableBuilder(column: $table.addedAt, builder: (column) => column);
}

class $$FollowedMatchesTableTableManager
    extends
        RootTableManager<
          _$CacheDb,
          $FollowedMatchesTable,
          FollowedMatch,
          $$FollowedMatchesTableFilterComposer,
          $$FollowedMatchesTableOrderingComposer,
          $$FollowedMatchesTableAnnotationComposer,
          $$FollowedMatchesTableCreateCompanionBuilder,
          $$FollowedMatchesTableUpdateCompanionBuilder,
          (
            FollowedMatch,
            BaseReferences<_$CacheDb, $FollowedMatchesTable, FollowedMatch>,
          ),
          FollowedMatch,
          PrefetchHooks Function()
        > {
  $$FollowedMatchesTableTableManager(_$CacheDb db, $FollowedMatchesTable table)
    : super(
        TableManagerState(
          db: db,
          table: table,
          createFilteringComposer: () =>
              $$FollowedMatchesTableFilterComposer($db: db, $table: table),
          createOrderingComposer: () =>
              $$FollowedMatchesTableOrderingComposer($db: db, $table: table),
          createComputedFieldComposer: () =>
              $$FollowedMatchesTableAnnotationComposer($db: db, $table: table),
          updateCompanionCallback:
              ({
                Value<int> fixtureId = const Value.absent(),
                Value<String> label = const Value.absent(),
                Value<DateTime?> kickoffAt = const Value.absent(),
                Value<bool> muted = const Value.absent(),
                Value<DateTime> addedAt = const Value.absent(),
              }) => FollowedMatchesCompanion(
                fixtureId: fixtureId,
                label: label,
                kickoffAt: kickoffAt,
                muted: muted,
                addedAt: addedAt,
              ),
          createCompanionCallback:
              ({
                Value<int> fixtureId = const Value.absent(),
                required String label,
                Value<DateTime?> kickoffAt = const Value.absent(),
                Value<bool> muted = const Value.absent(),
                required DateTime addedAt,
              }) => FollowedMatchesCompanion.insert(
                fixtureId: fixtureId,
                label: label,
                kickoffAt: kickoffAt,
                muted: muted,
                addedAt: addedAt,
              ),
          withReferenceMapper: (p0) => p0
              .map((e) => (e.readTable(table), BaseReferences(db, table, e)))
              .toList(),
          prefetchHooksCallback: null,
        ),
      );
}

typedef $$FollowedMatchesTableProcessedTableManager =
    ProcessedTableManager<
      _$CacheDb,
      $FollowedMatchesTable,
      FollowedMatch,
      $$FollowedMatchesTableFilterComposer,
      $$FollowedMatchesTableOrderingComposer,
      $$FollowedMatchesTableAnnotationComposer,
      $$FollowedMatchesTableCreateCompanionBuilder,
      $$FollowedMatchesTableUpdateCompanionBuilder,
      (
        FollowedMatch,
        BaseReferences<_$CacheDb, $FollowedMatchesTable, FollowedMatch>,
      ),
      FollowedMatch,
      PrefetchHooks Function()
    >;

class $CacheDbManager {
  final _$CacheDb _db;
  $CacheDbManager(this._db);
  $$CachedResponsesTableTableManager get cachedResponses =>
      $$CachedResponsesTableTableManager(_db, _db.cachedResponses);
  $$FavouriteTeamsTableTableManager get favouriteTeams =>
      $$FavouriteTeamsTableTableManager(_db, _db.favouriteTeams);
  $$FollowedMatchesTableTableManager get followedMatches =>
      $$FollowedMatchesTableTableManager(_db, _db.followedMatches);
}
