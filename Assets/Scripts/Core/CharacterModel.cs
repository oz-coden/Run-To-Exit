using UnityEngine;

namespace RunToExit.Core
{
    public enum CharacterType
    {
        Adult,
        Child,
        Macho,
        Patient
    }

    public class CharacterModel
    {
        public CharacterType Type { get; private set; }
        public Vector2Int GridPosition { get; set; }
        public int FacingDirection { get; set; } = 1;
        public CharacterState State { get; set; } = CharacterState.Idle;
        public ItemType? HeldItem { get; set; }

        // パラメータ
        public int Power { get; private set; }
        public int ClimbLimit { get; private set; }
        public float MoveSpeed { get; private set; }

        public CharacterModel(CharacterType type, Vector2Int startPos)
        {
            Type = type;
            GridPosition = startPos;
            InitializeStats();
        }

        private void InitializeStats()
        {
            switch (Type)
            {
                case CharacterType.Adult:
                    Power = 1;
                    ClimbLimit = 3;
                    MoveSpeed = 5f;
                    break;
                case CharacterType.Child:
                    Power = 0;
                    ClimbLimit = 1; // 子供は高い段差を登れない
                    MoveSpeed = 4f;
                    break;
                case CharacterType.Macho:
                    Power = 2; // 重いものを押せる
                    ClimbLimit = 3;
                    MoveSpeed = 4.5f;
                    break;
                case CharacterType.Patient:
                    Power = 0;
                    ClimbLimit = 0; // 自力で段差を登れない
                    MoveSpeed = 3f;
                    break;
            }
        }
    }
}
